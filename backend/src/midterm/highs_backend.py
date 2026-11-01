"""Pinned public HiGHS API, with original-model primal checks and cost starts."""
import hashlib
import time
from pathlib import Path

import highspy as hs
import numpy as np
from scipy.optimize import OptimizeResult
from scipy.sparse import vstack

PRIMAL_TOLERANCE = 1e-5


def fingerprint(*values):
    digest = hashlib.sha256()
    for value in values:
        array = np.ascontiguousarray(value)
        digest.update(str(array.shape).encode())
        digest.update(array.dtype.str.encode())
        digest.update(array.tobytes())
    return digest.hexdigest()


def violation(x, bounds, constraints, integer):
    if x is None or x.shape != bounds.lb.shape or not np.isfinite(x).all():
        return float('inf')
    worst = max(0., float(np.max(bounds.lb-x)), float(np.max(x-bounds.ub)))
    if (integer > 0).any():
        worst = max(worst, float(np.max(abs(x[integer > 0]-np.rint(x[integer > 0])))))
    for con in constraints:
        if con.A.shape[0]:
            value = con.A @ x
            worst = max(worst, float(np.max(con.lb-value)), float(np.max(value-con.ub)))
    return worst


def finite(value):
    return float(value) if value is not None and np.isfinite(value) else None


class Backend:
    """One instance per rolling window; never changes another job's solver."""

    def __init__(self, size, fuel_start, complete_seed, log_dir=None):
        self.size, self.fuel_start, self.complete_seed = size, fuel_start, complete_seed
        self.last, self.calls = None, 0
        self.log_dir = None if log_dir is None else Path(log_dir)
        if self.log_dir is not None:
            self.log_dir.mkdir(parents=True, exist_ok=False)

    def __call__(self, c, *, integrality, bounds, constraints, options, cost_stage=False, objective_scale=1.):
        began = time.perf_counter()
        self.calls += 1
        cost = cost_stage
        matrix = vstack([v.A for v in constraints], format='csc')
        matrix.sum_duplicates()
        matrix.sort_indices()
        lower = np.concatenate([np.broadcast_to(v.lb, (v.A.shape[0],)) for v in constraints])
        upper = np.concatenate([np.broadcast_to(v.ub, (v.A.shape[0],)) for v in constraints])
        solver = hs.Highs()
        if solver.version() != '1.12.0':
            raise RuntimeError('P3 requires the validated highspy==1.12.0')
        info = {'backend': 'highspy', 'version': solver.version(), 'objective_hash': fingerprint(c),
                    'matrix_hash': fingerprint(matrix.indptr, matrix.indices, matrix.data, lower, upper),
                    'bounds_integer_hash': fingerprint(bounds.lb, bounds.ub, integrality),
                    'options': dict(options), 'objective_scale': objective_scale,
                    'seed_submitted': False, 'seed_validated': False,
                    'seed_objective': None, 'solver_accepted_seed_log': None,
                    'first_solution_seconds': None, 'improvements': []}
        model = hs.HighsLp()
        model.num_col_, model.num_row_ = len(c), matrix.shape[0]
        model.col_cost_, model.col_lower_, model.col_upper_ = np.asarray(c, float), bounds.lb, bounds.ub
        model.row_lower_, model.row_upper_ = lower, upper
        model.integrality_ = [hs.HighsVarType.kInteger if v else hs.HighsVarType.kContinuous
                              for v in integrality]
        model.a_matrix_.format_ = hs.MatrixFormat.kColwise
        model.a_matrix_.start_ = matrix.indptr.astype(np.int32)
        model.a_matrix_.index_, model.a_matrix_.value_ = matrix.indices.astype(np.int32), matrix.data
        solver.setOptionValue('output_flag', False)
        for key, value in options.items():
            if solver.setOptionValue(key, value) != hs.HighsStatus.kOk:
                raise ValueError(f'Invalid HiGHS option: {key}')
        log_path = None
        if self.log_dir is not None:
            log_path = self.log_dir / f'{self.calls:02d}-{"cost" if cost else "front"}.log'
            if log_path.exists() or solver.setOptionValue('log_file', str(log_path)) != hs.HighsStatus.kOk:
                raise ValueError('Invalid or already-used solver log path')
            solver.setOptionValue('log_to_console', False)
            solver.setOptionValue('output_flag', True)
        if solver.passModel(model) != hs.HighsStatus.kOk:
            raise ValueError('HiGHS rejected the original model')
        seed = None
        if cost:
            if self.last is None:
                raise ValueError('No validated front solution for the cost start')
            seed = self.complete_seed(self.last.copy(), constraints)
            worst = violation(seed, bounds, constraints, integrality)
            info['seed_max_violation'] = worst
            if worst > PRIMAL_TOLERANCE:
                raise ValueError(f'Completed cost seed violates the original model by {worst}')
            info.update(seed_validated=True, seed_objective=float(c @ seed))
            solution = hs.HighsSolution()
            solution.col_value, solution.value_valid = seed, True
            status = solver.setSolution(solution)
            info.update(seed_submitted=status == hs.HighsStatus.kOk, seed_set_status=str(status))
            if status != hs.HighsStatus.kOk:
                raise ValueError('HiGHS rejected the completed cost start')

        def improved(event):
            data = event.data_out
            if info['first_solution_seconds'] is None:
                info['first_solution_seconds'] = float(data.running_time)
            info['improvements'].append({'seconds': float(data.running_time),
                'primal': finite(data.mip_primal_bound), 'dual': finite(data.mip_dual_bound),
                'gap': finite(data.mip_gap), 'nodes': int(data.mip_node_count)})

        solver.cbMipImprovingSolution.subscribe(improved)
        if self.log_dir is not None:
            np.savez_compressed(self.log_dir / f'{self.calls:02d}-model.npz', objective=c,
                lower=bounds.lb, upper=bounds.ub, integer=integrality, row_lower=lower,
                row_upper=upper, start=matrix.indptr, index=matrix.indices, value=matrix.data,
                seed=np.array([]) if seed is None else seed)
        setup, run_began = time.perf_counter()-began, time.perf_counter()
        run_status = solver.run()
        seconds = time.perf_counter()-run_began
        status, solution, stats = solver.getModelStatus(), solver.getSolution(), solver.getInfo()
        if run_status == hs.HighsStatus.kError:
            raise RuntimeError(solver.modelStatusToString(status))
        x = (np.asarray(solution.col_value, float) if solution.value_valid
             and stats.primal_solution_status == hs.kSolutionStatusFeasible else None)
        worst = violation(x, bounds, constraints, integrality)
        if x is not None and worst > PRIMAL_TOLERANCE:
            raise RuntimeError(f'HiGHS incumbent violates the original model by {worst}')
        code = (0 if status == hs.HighsModelStatus.kOptimal else
                2 if status == hs.HighsModelStatus.kInfeasible else
                3 if status == hs.HighsModelStatus.kUnbounded else 1)
        fun = None if x is None else float(c @ x)
        if x is not None and not cost:
            self.last = x.copy()
        if log_path is not None:
            info['solver_accepted_seed_log'] = 'MIP start solution is feasible' in log_path.read_text(
                encoding='utf-8', errors='replace')
        info.update(setup_seconds=setup, run_seconds=seconds, model_status=str(status),
            improved_over_seed=bool(seed is not None and fun is not None
                                    and fun < info['seed_objective']-objective_scale),
            seed_to_final_improvement=None if seed is None or fun is None else info['seed_objective']-fun,
            absolute_bound_gap=None if x is None else finite(abs(fun-stats.mip_dual_bound)),
            raw_max_violation=None if x is None else worst)
        if self.log_dir is not None:
            np.savez_compressed(self.log_dir / f'{self.calls:02d}-solution.npz',
                                x=np.array([]) if x is None else x)
        return OptimizeResult(x=x, fun=fun, success=code == 0, status=code,
            message=solver.modelStatusToString(status), mip_gap=None if x is None else float(stats.mip_gap),
            mip_dual_bound=finite(stats.mip_dual_bound), mip_node_count=int(stats.mip_node_count),
            validation=info)
