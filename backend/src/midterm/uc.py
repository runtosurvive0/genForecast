"""[포크] national-solar-forecast `dss/coal_uc.py` (커밋 be2a0a0). MILP 본체는 그대로 두고 원천
패키지 import 세 곳만 이 프로젝트의 것으로 바꿨다(달력, 동해안 그룹, 호기명 정규화).

Hourly coal-only commitment. Costs are KRW/kWh, power MW, duration hours."""
import math
import time

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix


def horizon_days(start, days):
    """Include the full first workday following a weekend/holiday at the end."""
    from datetime import timedelta
    from midterm.calendar import covers, day_type, WEEKDAY
    if days < 1:
        raise ValueError('Invalid horizon')
    days = max(2, days)
    while True:
        end = start + timedelta(days=days-1)
        if not covers(start) or not covers(end):
            raise ValueError('MILP 계산기간의 공휴일 달력 없음')
        if day_type(end) == WEEKDAY:
            return days
        days += 1


#: 동해안 송전제약. `east <= min(share x 석탄목표, 절대상한)`, 시간별.
#:
#: 2026-01~04 로 적합하고 05~07 로 검증했다: 이 형태는 검증구간의 1.3% 에서만 초과하고 82% 에서
#: 가용설비보다 낮게 걸린다. 절대상한은 212일 관측 최대이며, 가용설비가 6,000 MW 넘는 시간에도
#: 넘긴 적이 없다 -- 정비로 못 돈 것이 아니라 못 넘는 천장이다.
#:
#: 앞서 쓰던 형태는 일 최저 순수요로 감축량을 정해(45,000 MW 이하 3,500 · 50,000 이상 2,500,
#: 선형보간) 하루 전체에 같은 상한을 걸었다. 운영자 진술을 그대로 옮긴 값이고 검증 전이었으며,
#: `docs/validation/2026-09-11-coal-uc-24h-backtest.md` 가 지역 조건은 이번 실험에 적용하지
#: 않았다고 적어 둔 그 부분이다. 하루 한 값이라 경부하 시간과 첨두 시간에 같은 상한이 걸린다는
#: 문제도 있었다.
EAST_SHARE_OF_COAL = 0.2152
EAST_ABSOLUTE_MW = 4880.0

#: 석탄 목표가 이 아래면 동해안 발전소는 각각 최대 한 기만 돈다.
#:
#: 합계 상한만으로는 이 사실을 말할 수 없다. 합계를 정확히 맞추면서도 싼 발전소를 다 돌리고
#: 비싼 쪽을 통째로 세우는 조합이 통과한다 -- 2026-09-12 전망이 삼척그린 2/2 · 삼척화력 2/2 ·
#: 강릉안인 0/2 · 북평 0/2 를 골랐다. 실적은 그렇게 하지 않는다: 2026-01~07 에서 석탄 10~17 GW ·
#: 두 기 모두 가용인 시간의 '2기 동시가동' 비율은 삼척그린 0%, 삼척화력 3%, 북평 2%, 강릉안인
#: 5% 였고, 여덟 기가 모두 가용이던 54시간에 (2,2,0,0) 모양은 한 번도 없다.
#:
#: 임계 16,000 MW 는 같은 방식으로 골랐다 -- 1~4월 적합, 5~7월 검증에서 위반 2.4%(14,000 이면
#: 0.5%, 18,000 이면 6.5%). 위로는 두 기가 보통이라(18 GW 초과 39%) 상한이 풀린다. 잔여 위반은
#: 대부분 강릉안인이며, 발전소별로 임계를 따로 두면 더 맞겠지만 표본이 그만큼 작아진다.
EAST_PLANTS = ('삼척그린', '삼척화력', '강릉안인', '북평')
EAST_PLANT_COAL_MAX_MW = 16_000.0
EAST_PLANT_MAX_UNITS = 1


def east_coast_caps(names, days, coal_target, maximum, outage):
    """동해안 합계 출력상한과, 화면에 적을 근거.

    송전제약을 비용 가산이 아니라 상한으로 거는 이유: 동해안 8기는 계통에서 가장 싼 축이라
    (삼척화력 싼쪽 1~3%, 강릉안인 15~20%) 원가정렬은 이들을 가장 나중에 세우려 하는데 실적은
    경부하에서 가장 먼저 세운다(가용설비 대비 이용률 경부하 20% 대 중부하↑ 51%). 가격으로 흉내
    내면 한 계절에 맞은 값이 다음 계절에 틀린다.
    """
    from midterm.units import group_of, TRANSMISSION
    target = np.asarray(coal_target, float)
    maxima, outages = np.asarray(maximum, float), np.asarray(outage, bool)
    if target.shape != (len(days),) or maxima.shape != (len(days),len(names)) or outages.shape != maxima.shape or not np.isfinite(target).all() or (target < 0).any() or not np.isfinite(maxima).all() or (maxima < 0).any():
        raise ValueError('Invalid east coast target/capacity inputs')
    indices = [j for j,n in enumerate(names) if group_of(n)==TRANSMISSION]
    if not indices:
        raise ValueError('동해안 대상 호기 없음: 감축 상한 계산 불가')
    limits = [float(min(EAST_SHARE_OF_COAL*t, EAST_ABSOLUTE_MW)) for t in target]
    available = (maxima[:,indices] * ~outages[:,indices]).sum(axis=1)
    evidence = {'rule':f'min({EAST_SHARE_OF_COAL:.4f} x 석탄목표, {EAST_ABSOLUTE_MW:,.0f} MW)',
                'basis':'2026-01~04 적합 · 05~07 검증 초과 1.3% · 구속 82%',
                'hours_binding':int(sum(1 for i,v in enumerate(limits) if v < available[i]))}
    return [{'indices':indices,'maximum_mw':limits}], evidence


def east_plant_unit_caps(names, coal_target):
    """석탄이 적은 시간에 동해안 발전소를 각각 한 기로 묶는다. (제약 목록, 화면에 적을 근거).

    `transmission_groups.TRANSMISSION_CONSTRAINED_PLANTS` 를 쓸 수 없다 -- 거기의 "삼척" 은
    삼척그린과 삼척화력을 한 덩어리로 묶는데, 이 제약은 발전소마다 따로 걸린다.
    """
    from midterm.units import canonical_unit_name
    groups, described = [], []
    for plant in EAST_PLANTS:
        index = [j for j,n in enumerate(names) if canonical_unit_name(n).startswith(plant)]
        if len(index) <= EAST_PLANT_MAX_UNITS:
            continue                        # 한 기뿐인 발전소에는 걸 것이 없다
        line = [EAST_PLANT_MAX_UNITS if t <= EAST_PLANT_COAL_MAX_MW else len(index)
                for t in coal_target]
        groups.append({'indices':index,'maximum_units':line})
        described.append({'plant':plant,'units':[names[j] for j in index],
                          'limit':EAST_PLANT_MAX_UNITS,
                          'hours_binding':sum(1 for t in coal_target if t <= EAST_PLANT_COAL_MAX_MW)})
    note = ({'rule':f'석탄목표 <= {EAST_PLANT_COAL_MAX_MW:,.0f} MW 인 시간에 발전소마다 최대 '
                    f'{EAST_PLANT_MAX_UNITS}기','basis':'2026-01~04 적합 · 05~07 검증 위반 2.4%',
             'plants':described} if described else None)
    return groups, note


def _pinned_initial_state(online, output, elapsed, *, n):
    """호기별로 **아는 초기상태만** 고정한다. 아무것도 주지 않으면 `None`.

    세 배열은 길이 `n` 이고, 한 호기의 자리에 `None` 을 두면 "이 호기는 모른다" 는 뜻이다 --
    그 호기는 예전처럼 초기 석탄 목표에서 역산된다. 세 배열의 `None` 자리는 서로 같아야 한다.
    한 호기의 출력만 알고 운전 여부를 모른다는 상태는 말이 되지 않고, 허용하면 그 호기가 꺼진
    채로 출력을 내는 답이 나온다.

    **왜 부분인가.** 신뢰도발전계획 API 는 자사 호기만 준다 -- 전국 석탄 56기 중 당진 10기다.
    전부-아니면-전무였을 때는 그 10기의 실제 계획값을 버리거나, 나머지 46기의 초기상태를 아는
    척 지어내거나 둘 중 하나였다. 둘 다 틀린 선택이라 세 번째를 만든다.
    """
    given = [a for a in (online, output, elapsed) if a is not None]
    if not given:
        return None
    if len(given) != 3:
        raise ValueError('All initial state fields are required together')
    arrays = [np.asarray([np.nan if v is None else v for v in a], float)
              for a in (online, output, elapsed)]
    if any(a.shape != (n,) for a in arrays):
        raise ValueError('Invalid initial state dimensions or online flags')
    missing = [np.isnan(a) for a in arrays]
    if not (np.array_equal(missing[0], missing[1]) and np.array_equal(missing[0], missing[2])):
        raise ValueError('Initial state must be known for all three fields of a unit or none')
    known = ~missing[0]
    if not known.any():
        return None
    online_a, output_a, elapsed_a = arrays
    if not np.isin(online_a[known], [0, 1]).all():
        raise ValueError('Invalid initial state dimensions or online flags')
    if (not np.isfinite(output_a[known]).all() or not np.isfinite(elapsed_a[known]).all()
            or (output_a[known] < 0).any() or (elapsed_a[known] < 0).any()):
        raise ValueError('Invalid initial output or elapsed time')
    online_b = np.nan_to_num(online_a).astype(bool)
    # 꺼진 호기가 출력을 내고 있다는 입력은 받지 않는다. 받으면 그 MW 가 초기 합계에 들어가
    # 전 구간이 그만큼 어긋난 채로 풀린다.
    if (output_a[known & ~online_b] != 0).any():
        raise ValueError('Invalid initial output or elapsed time')
    return known, np.nan_to_num(online_a).astype(bool), np.nan_to_num(output_a), np.nan_to_num(elapsed_a)


def _withheld_capacity(power, online, maximum, ramp, outage, initial, initial_output, elapsed, down):
    """부족한 시간마다, 운전제약이 붙잡고 있던 MW 를 두 가지로 나눠 센다.

    (최소 정지시간에 묶여 못 돌아온 MW, 출력변동률 상한에 걸려 못 올린 MW). 둘 다 "그 제약이
    없었다면 이 시간에 더 낼 수 있었을 양" 이지 해의 일부가 아니다 -- 부족의 원인을 짚는 데만 쓴다.

    정지시간 쪽이 해질녘 부족의 보통 원인이다. 낮 최저부하에 세운 호기는 정지시간이 끝나기 전에
    18시로 돌아올 수 없고, 그 사실은 "결합 제약" 이라는 말로는 운영자에게 전달되지 않는다.

    정비 중인 호기는 정지시간에 묶인 것이 아니라 애초에 없는 설비이므로 세지 않는다. 그쪽은
    `available_maximum_below_target` 이 이미 말한다.
    """
    hours, units = online.shape
    blocked = np.zeros(hours)
    ramped = np.zeros(hours)
    for j in range(units):
        # 시각 t 직전까지 연속으로 정지해 있던 시간. 초기 상태가 정지면 그 경과시간에서 잇는다.
        prior = 0.0 if initial[j] else float(elapsed[j])
        for t in range(hours):
            if online[t, j]:
                previous = float(initial_output[j]) if t == 0 else float(power[t - 1, j])
                ceiling = min(float(maximum[t, j]), previous + float(ramp[t, j]) * 60)
                if float(power[t, j]) >= ceiling - .01 and float(maximum[t, j]) > ceiling + .01:
                    ramped[t] += float(maximum[t, j]) - ceiling
                prior = 0.0
                continue
            # `prior >= 1` -- 그 시간에 막 세운 호기는 묶인 것이 아니라 세우기로 한 것이다.
            # 세운 시간까지 "정지시간 때문에 못 왔다" 고 적으면, 풀이가 고른 정지가 제약 탓으로
            # 읽힌다.
            if not outage[t, j] and 1 <= prior < down[j]:
                blocked[t] += float(maximum[t, j])
            prior += 1
    return blocked, ramped


def startup_ramp(minimum, maximum, ramp_up):
    """정각에 0 MW 로 병입해 증발률로 올릴 때, 기동 뒤 k 시간째의 **한 시간 평균출력**.

    출력은 시간 평균이다(화면이 시간당 발전량으로 읽는다). 그런데 병입 순간은 0 MW 이고 거기서
    증발률 r 로 올라가므로, 기동한 그 시간의 평균은 최소출력에 못 미친다 -- 한 시간 내내 올려도
    평균은 30r 이다. 예전 식은 기동 시간에 0~최소출력을 아무 값이나 허용했고, 풀이는 필요하면
    곧바로 최소출력을 냈다.

    신뢰도발전계획의 실제 기동 30건(2026-06~09 당진)과 맞춰 본 결과:

        500급  계획 121 → 241 MW       이 식(당진2, 4.1 MW/min) 123 → 278
        1000급 계획 288 → 576 MW       이 식(당진9, 8.7 MW/min) 261 → 649

    기동 시간은 거의 맞는다. 그리고 **1000급은 둘째 시간에도 최소출력에 못 닿는다**(당진9 는
    77분째). 기동 시간만 고치면 둘째 시간의 최소출력 제약과 부딪혀 풀이가 불가능해지므로, 최소출력에
    닿을 때까지의 시간 전부를 여기서 같이 푼다.

    반환: (floors, allowance)
      floors[k]  (h,n)  기동 뒤 k 시간째 평균출력 하한. 최소출력까지 증발률로 올린 뒤 그 자리에
                        머무는 궤적이다 -- 최소출력에 가장 빨리 닿는 길이고, 병입한 호기를 도중에
                        세워 두지 않는다. 최소출력에 닿은 뒤의 시간은 목록에 없다(그 하한은 최소출력
                        자체이고, 평소 제약이 맡는다).
      allowance  (h,n)  기동 시간 평균출력 상한. 한 시간 내내 증발률로 올릴 때의 평균이다. 그다음
                        시간부터는 평소 증발률 제약이 이 값에서 이어받는다.
    """
    minimum, maximum, ramp_up = (np.asarray(a, float) for a in (minimum, maximum, ramp_up))
    reach = minimum / ramp_up              # 최소출력까지 걸리는 분. ramp_up > 0 은 호출 전에 확인된다
    hours = int(np.ceil(reach.max() / 60.0)) if reach.size else 0
    floors = []
    for k in range(hours):
        begin, end = 60.0 * k, 60.0 * (k + 1)
        ramping = ramp_up * (begin + 30.0)                     # 이 시간 내내 올리는 중
        crossing = (ramp_up / 2.0 * (reach ** 2 - begin ** 2)  # 이 시간 안에 최소출력에 닿는다
                    + minimum * (end - reach)) / 60.0
        floors.append(np.where(reach >= end, ramping, np.where(reach <= begin, minimum, crossing)))
    allowance = np.minimum(maximum, 30.0 * ramp_up)
    return floors, allowance


def ramp_floor_from(start, minimum, ramp_up, hour):
    """`start` MW 에서 증발률로 최소출력까지 올린 뒤 머무는 궤적의, `hour` 시간째 평균출력.

    창이 열릴 때 **아직 올라가는 중인** 호기에 쓴다. `startup_ramp` 는 정각에 0 MW 로 병입한다고
    놓지만, 경계 직전에 병입한 호기는 언제 병입했는지 모른다 -- 2026-02-01 23시 당진6 은 평균
    10 MW 였다. 23:50 쯤 병입했다는 뜻이고, "기동 뒤 둘째 시간" 으로 치면 00시 하한이 237 MW 인데
    10 + 60×2.7 = 172 MW 까지밖에 못 오른다. 몇 시간째인지 추정하지 않고 **관측한 출력에서부터**
    올린다. 시간 평균을 그 순간의 출력으로 놓으므로 실제보다 낮게 잡힌다(하한이라 그 편이 안전하다),
    그리고 증발률 제약으로 늘 도달할 수 있다.
    """
    if ramp_up <= 0 or start >= minimum:
        return float(minimum)
    reach = (minimum - start) / ramp_up
    begin, end = 60.0 * hour, 60.0 * (hour + 1)
    if reach >= end:
        return float(start + ramp_up * (begin + 30.0))
    if reach <= begin:
        return float(minimum)
    return float((start * (reach - begin) + ramp_up / 2.0 * (reach ** 2 - begin ** 2)
                  + minimum * (end - reach)) / 60.0)


# 예비력 1 MW 가 모자란 한 시간의 값. 호기 하나를 더 켜 두는 비용(최소출력 연료 차이·기동비,
# 대개 수천만 원)보다 커서 채울 수 있으면 채우고, 목표 부족분보다는 뒤에 온다.
RESERVE_SHORTFALL_WON_PER_MW = 1e7


def solve_coal_uc(target, minimum, maximum, ramp, costs, must, outage,
                  uptime, downtime, *, startup_cost=0.0, shutdown_cost=0.0,
                  initial_target=None, initial_online=None, initial_output=None,
                  initial_elapsed_hours=None, group_caps=(),
                  group_online_minimums=(), group_online_maximums=(), time_limit=60.0,
                  cost_time_limit=None,
                  allow_approximate=False, fuel_curve=None, fuel_segments=6,
                  ramp_down=None, reserve_mw=None, commitment_reference=None, inertia_won=0.0,
                  group_online_targets=(), event_penalty=None, mip_rel_gap=0.001,
                  single_stage=False, slack_penalty_won=5e7, highs_options=None,
                  objective_scale=1.0, no_load_won=None):
    """Daily inputs have shape (hours, units). Unknown initial ages are satisfied.

    Slack is minimised before money. Nonzero slack is explicitly infeasible for
    the requested coal target, never reported as a feasible dispatch plan.
    """
    target = np.asarray(target, dtype=float)
    # 켜 둔 호기의 최대출력 합이 석탄 목표보다 이만큼 커야 한다 -- 운전예비력. 기본은 없음.
    #
    # 2026-02~07 실적 백테스트(목표를 실제 석탄으로 고정, 34일)에서 비용만 보는 풀이는 실제보다
    # 평균 3기 적게 켜고 여유를 677 MW 만 두었다. 실제는 2,315 MW(석탄 대비 중앙 12.9%)였다.
    # 필요한 만큼만 켜서 꽉 채우는 것이 비용 최적이고, 계통은 예비력 때문에 그렇게 돌리지 않는다.
    reserve = None if reserve_mw is None else np.asarray(reserve_mw, dtype=float)
    # 기준 운전상태(1/0, 모르면 nan)와 다른 호기-시간마다 inertia_won 원을 물린다 -- 관성 벌점.
    # 돈으로 보면 같은 답이 여럿일 때 실제 운영처럼 어제 하던 대로 가는 쪽을 고르게 한다.
    # 보고하는 cost_won 에는 넣지 않는다.
    reference = None if commitment_reference is None else np.asarray(commitment_reference, dtype=float)
    minimum, maximum, ramp_up, costs = [np.asarray(a, dtype=float)
                                        for a in (minimum, maximum, ramp, costs)]
    ramp_down = np.asarray(ramp_up if ramp_down is None else ramp_down, dtype=float)
    must, outage = np.asarray(must, bool), np.asarray(outage, bool)
    h, n = minimum.shape
    # Coefficients already multiplied by heat price: won/hour, P in MW.
    quadratic = None if fuel_curve is None else np.asarray(fuel_curve, float)
    if not isinstance(fuel_segments, int) or isinstance(fuel_segments, bool) or not 1 <= fuel_segments <= 100:
        raise ValueError('Fuel segments must be an integer from 1 to 100')
    if quadratic is not None and (quadratic.shape != (h,n,3) or
            not np.isfinite(quadratic).all() or (quadratic < 0).any()):
        raise ValueError('Fuel curve must be finite nonnegative (hours, units, [a,b,c])')
    if reserve is not None and (reserve.shape != (h,) or not np.isfinite(reserve).all()
                                or (reserve < 0).any()):
        raise ValueError('Reserve must be finite nonnegative MW per hour')
    if not np.isfinite(inertia_won) or inertia_won < 0:
        raise ValueError('Inertia penalty must be finite nonnegative won')
    if reference is not None and (reference.shape != (h, n) or
            ((reference[np.isfinite(reference)] < 0) | (reference[np.isfinite(reference)] > 1)).any()):
        # 0/1 이 아닌 값은 "평소 이 시각에 켜져 있던 비율" 이다. |u - p| 는 u 가 0/1 이라
        # p + u(1-2p) 로 여전히 선형이고, p=0.5 면 벌점이 어느 쪽으로도 밀지 않는다.
        raise ValueError('Commitment reference must be within [0, 1] or nan per (hour, unit)')
    if h < 2 or target.shape != (h,) or any(a.shape != (h, n) for a in
            (maximum, ramp_up, ramp_down, costs, must, outage)):
        raise ValueError('UC input dimensions do not match')
    if any(not np.isfinite(a).all() for a in (target, minimum, maximum, ramp_up, ramp_down, costs)):
        raise ValueError('UC inputs must be finite')
    if ((target < 0).any() or (minimum < 0).any() or (maximum < minimum).any()
            or (ramp_up <= 0).any() or (ramp_down <= 0).any() or (costs < 0).any()):
        raise ValueError('Invalid UC power/ramp/cost values')
    start_cost = np.broadcast_to(np.asarray(startup_cost, float), (h,n))
    if not np.isfinite(start_cost).all() or (start_cost < 0).any() or not math.isfinite(shutdown_cost) or shutdown_cost < 0:
        raise ValueError('Transition costs must be finite and nonnegative')
    up, down = [np.ceil(np.asarray(a, float)).astype(int) for a in (uptime, downtime)]
    if up.shape != (n,) or down.shape != (n,) or (up < 1).any() or (down < 1).any():
        raise ValueError('Invalid minimum operating times')
    initial = must[0] & ~outage[0]
    needed = target[0] if initial_target is None else float(initial_target)
    if not math.isfinite(needed) or needed < 0:
        raise ValueError('Invalid initial target')
    # 실제로 아는 호기는 여기서 고정하고, 나머지만 추정으로 채운다. 전부-아니면-전무였을 때는
    # 자사 계획값이 있는 당진 10기 때문에 전국 56기 전부의 초기상태를 지어내야 했다 -- 아는
    # 것을 버리거나, 모르는 것을 아는 척하거나 둘 중 하나였다.
    pinned = _pinned_initial_state(initial_online, initial_output, initial_elapsed_hours, n=n)
    known = np.zeros(n, bool) if pinned is None else pinned[0]
    free = ~known
    if pinned is not None:
        _, online_known, output_known, elapsed_known = pinned
        initial[known] = online_known[known]
        # 아는 호기가 이미 내는 만큼은 잔여 목표에서 뺀다. 그래서 아래 두 루프는 **모르는
        # 호기만** 놓고 센다 -- 고정된 호기의 용량이나 최저출력을 같이 세면 같은 MW 를 두 번
        # 세는 것이고, 고정 호기가 크면 나머지가 통째로 0 으로 남는다.
        needed = max(0.0, needed - float(output_known[known].sum()))
    for j in np.argsort(costs[0], kind='stable'):
        if float((maximum[0] * initial * free).sum()) >= needed:
            break
        if not outage[0, j] and free[j]:
            initial[j] = True
    p0 = minimum[0] * initial * free
    for j in np.argsort(costs[0], kind='stable'):
        if not free[j]:
            continue
        p0[j] += min(max(0, needed - p0.sum()), (maximum[0, j] - p0[j]) * initial[j])
    elapsed = np.where(initial, up, down).astype(float)
    if pinned is not None:
        p0[known] = output_known[known]
        elapsed[known] = elapsed_known[known]
    if pinned is not None and known.all():
        # 전 호기를 다 아는 경우는 예전과 같아야 한다 -- 초기 목표도 추정이 아니라 합계다.
        needed = float(p0.sum())
    remaining = np.maximum(0, np.ceil(np.where(initial, up, down) - elapsed)).astype(int)
    floors, allowance = startup_ramp(minimum, maximum, ramp_up)
    caps = []
    for cap in group_caps:
        indices = list(cap['indices'])
        limit = np.asarray(cap['maximum_mw'], float)
        if not indices or len(set(indices)) != len(indices) or any(not isinstance(j, (int, np.integer)) or not 0 <= j < n for j in indices) or limit.shape != (h,) or not np.isfinite(limit).all() or (limit < 0).any():
            raise ValueError('Invalid group cap')
        caps.append((indices, limit))

    def group_counts(groups, field, label):
        """운전 기수 하한/상한. `group_caps` 가 MW 를 묶는다면 이쪽은 돌고 있는 호기 수를 묶는다.

        `must` 로는 둘 다 쓸 수 없다 -- `must` 는 호기를 지목하는데 이 제약은 개수를 묶고 어느
        호기가 그것을 채울지는 풀이가 고른다. 실적이 그 모양이다: 삼천포 단독 운전 당번은
        2026-01~07 에 6호기 387h, 3호기 161h, 4호기 66h, 5호기 38h 로 돌아갔다.
        """
        out = []
        for group in groups:
            indices = list(group['indices'])
            line = np.broadcast_to(np.asarray(group[field], float), (h,)).astype(float)
            if not indices or len(set(indices)) != len(indices) or any(not isinstance(j, (int, np.integer)) or not 0 <= j < n for j in indices) or not np.isfinite(line).all() or (line < 0).any() or (line > len(indices)).any():
                raise ValueError(f'Invalid group {label}')
            out.append((indices, line))
        return out

    online_min = group_counts(group_online_minimums, 'minimum_units', 'minimum')
    online_max = group_counts(group_online_maximums, 'maximum_units', 'maximum')
    # 걸 수 없는 요청은 시각을 지목해 거절한다. 그러지 않으면 풀이가 `target_infeasible` 로
    # 돌아오고 운영자는 석탄 목표가 틀렸다고 읽는다 -- 여수는 2026-01-31 13~15시에 두 기 모두
    # 섰으므로 실자료에서 일어나는 일이다.
    for t in range(h):
        for indices, line in online_min:
            free = int((~outage[t, indices]).sum())
            if free < line[t]:
                raise ValueError(f'UC group needs {line[t]:.0f} online at hour {t} but only {free} of its units are available')
        for indices, line in online_max:
            forced = int((must[t, indices] & ~outage[t, indices]).sum())
            if forced > line[t]:
                raise ValueError(f'UC group maximum {line[t]:.0f} at hour {t} contradicts {forced} must-run units in the same set')
    size = h * n
    def ix(kind, t, j):
        return kind * size + t * n + j
    # p, on, start, stop, shortage, excess
    peak_index = 4 * size + 2 * h
    cost_start = peak_index + int(allow_approximate)
    reserve_start = cost_start + (size if quadratic is not None else 0)
    count = reserve_start + (h if reserve is not None else 0)
    # 발전소 기수 목표: Σu - 초과 + 부족 = 목표. 벗어난 만큼 기수당 penalty_won. 하드 하한
    # (group_online_minimums)과 달리 못 맞춰도 답이 난다 -- 타사 머스트런은 1~2주마다 바뀌고 알 수
    # 없어서, 평소 몇 기가 돌았는지는 "지켜야 할 규칙" 이 아니라 "기울여야 할 방향" 이다.
    soft_groups = []
    for g in group_online_targets:
        indices = list(g['indices'])
        line = np.broadcast_to(np.asarray(g['target'], float), (h,))
        penalty = float(g['penalty_won'])
        if (not indices or len(set(indices)) != len(indices)
                or any(not isinstance(j, (int, np.integer)) or not 0 <= j < n for j in indices)
                or not np.isfinite(line).all() or (line < 0).any() or not math.isfinite(penalty) or penalty < 0):
            raise ValueError('Invalid group online target')
        soft_groups.append((indices, line, penalty))
    soft_start = count
    count = soft_start + 2 * h * len(soft_groups)
    steer_start = steer_stop = None
    if event_penalty is not None:
        # 시각별 기동·정지 벌점(원). 계획은 0~3시에 세우고 13~17시에 붙인다 -- 그 밖 시각의 사건을
        # 비싸게 두면 같은 기동·정지라도 계획의 시각으로 옮겨 간다. 보고 비용에는 넣지 않는다.
        steer_start, steer_stop = (np.broadcast_to(np.asarray(event_penalty.get(k, 0.0), float), (h, n))
                                   for k in ('start', 'stop'))
        if not (np.isfinite(steer_start).all() and np.isfinite(steer_stop).all()
                and (steer_start >= 0).all() and (steer_stop >= 0).all()):
            raise ValueError('Event penalty must be finite nonnegative won per (hour, unit)')
    lower, upper = np.zeros(count), np.full(count, np.inf)
    # A usable plan must meet the target: neither excess nor supply shortage
    # is permission to violate the operating requirement.
    if not allow_approximate:
        upper[4*size:cost_start] = 0
    upper[size:4*size] = 1
    integer = np.zeros(count)
    integer[size:4*size] = 1
    rows, cols, values, lbs, ubs = [], [], [], [], []
    fuel_rows = []
    def add(terms, lb=-np.inf, ub=np.inf):
        k = len(lbs)
        for col, value in terms:
            rows.append(k); cols.append(col); values.append(value)
        lbs.append(lb); ubs.append(ub)
    for t in range(h):
        add([(ix(0,t,j), 1) for j in range(n)] + [(4*size+t, 1), (4*size+h+t, -1)], target[t], target[t])
        for indices, limit in caps:
            add([(ix(0,t,j), 1) for j in indices], ub=limit[t])
        if reserve is not None and reserve[t] > 0:
            # 켜진 호기의 최대출력 합 + 부족분 ≥ 목표 + 예비력. 부족분은 돈 단계에서 비싸게 물려
            # 채울 수 있으면 채운다. 하드 제약이던 때는 최소정지시간에 묶인 호기까지 "켤 수 있다"
            # 고 세어 2026-02~05 백테스트 36일 중 4일이 통째로 답 없이 끝났다(정비 호기만 뺐다).
            available = float(maximum[t][~outage[t]].sum())
            need = min(target[t] + reserve[t], available)
            add([(ix(1,t,j), maximum[t,j]) for j in range(n)] + [(reserve_start+t, 1)], lb=need)
        for indices, line in online_min:
            add([(ix(1,t,j), 1) for j in indices], lb=line[t])
        for indices, line in online_max:
            add([(ix(1,t,j), 1) for j in indices], ub=line[t])
        for k_, (indices, line, _) in enumerate(soft_groups):
            base = soft_start + 2 * h * k_
            add([(ix(1,t,j), 1) for j in indices] + [(base+t, -1), (base+h+t, 1)], line[t], line[t])
        for j in range(n):
            p,u,y,z = [ix(k,t,j) for k in range(4)]
            if quadratic is not None:
                a,b,c = quadratic[t,j]
                knots = np.linspace(minimum[t,j], maximum[t,j], fuel_segments+1)
                # Convex secant envelope. Multiplying intercept by on makes off cost zero.
                for left,right in zip(knots[:-1],knots[1:]):
                    slope = a*(left+right)+b
                    intercept = c-a*left*right
                    # Fuel epigraphs cannot change whether a dispatch is physically feasible.
                    # Keep them out of the exact/slack searches and add them only for money.
                    fuel_rows.append([(cost_start+t*n+j,1),(p,-slope/1e6),
                                      (u,-intercept/1e6)])
            if outage[t,j]:
                upper[u] = 0
            elif must[t,j]:
                lower[u] = 1
            if t < remaining[j]:
                # Do not silently relax a conflicting initial commitment/outage.
                add([(u, 1)], int(initial[j]), int(initial[j]))
            add([(p,1),(u,-maximum[t,j])], ub=0)
            # 기동 뒤 최소출력에 닿기까지는 증발률이 정한 평균출력이 하한이다(`startup_ramp`).
            # 그 시간 수만큼 거슬러 올라간 기동 변수가 하한을 풀어 준다 -- 최소 운전시간이 그
            # 창보다 길어서 창 안에 기동은 많아야 하나다.
            floor_terms = [(p,1),(u,-minimum[t,j])]
            for k,floor in enumerate(floors):
                if t-k >= 0 and floor[t,j] < minimum[t,j]:
                    floor_terms.append((ix(2,t-k,j), minimum[t,j]-floor[t,j]))
            floor_lb = 0.0
            # 창이 열리기 직전에 병입해 아직 올라가는 중인 호기(초기 출력이 최소출력 아래). 몇
            # 시간째인지 추정하지 않고 관측한 초기 출력에서부터 올린다 -- `ramp_floor_from`.
            if initial[j] and p0[j] < minimum[t,j]:
                level = ramp_floor_from(p0[j], minimum[t,j], ramp_up[t,j], t)
                if level < minimum[t,j]:
                    floor_lb = level - minimum[t,j]
            add(floor_terms, lb=floor_lb)
            if t == 0:
                add([(u,1),(y,-1),(z,1)],int(initial[j]),int(initial[j]))
            else:
                add([(u,1),(ix(1,t-1,j),-1),(y,-1),(z,1)],0,0)
            add([(y,1),(z,1)],ub=1)
            add([(ix(2,k,j),1) for k in range(max(0,t-up[j]+1),t+1)] + [(u,-1)],ub=0)
            # Forced maintenance wins over a previously chosen minimum uptime.
            # Conflicts remain infeasible rather than silently relaxing the constraint.
            add([(ix(3,k,j),1) for k in range(max(0,t-down[j]+1),t+1)] + [(u,1)],ub=1)
            # 기동 시간의 평균출력은 한 시간 내내 증발률로 올린 만큼이 상한이다(`startup_ramp`).
            # 예전에는 최소출력이었고, 풀이는 병입하자마자 최소출력을 냈다. 다음 시간부터는
            # 평소 증발률이 이 값에서 이어받는다.
            if t == 0:
                add([(p,1),(y,-allowance[t,j])],
                    ub=p0[j]+ramp_up[t,j]*60*int(initial[j]))
                add([(p,-1),(z,-minimum[t,j])],ub=ramp_down[t,j]*60-p0[j])
            else:
                add([(p,1),(ix(0,t-1,j),-1),(y,-allowance[t,j]),
                     (ix(1,t-1,j),-ramp_up[t,j]*60)],ub=0)
                add([(ix(0,t-1,j),1),(p,-1),(z,-minimum[t-1,j])],ub=ramp_down[t,j]*60)
    if allow_approximate:
        for begin in range(0,h,24):
            chunk=target[begin:begin+24]
            peaks=np.flatnonzero((chunk==chunk.min()) | (chunk==chunk.max()))+begin
            for t in peaks:
                add([(4*size+t,1),(4*size+h+t,1),(peak_index,-1)],ub=0)
    matrix = coo_matrix((values,(rows,cols)),shape=(len(lbs),count)).tocsc()
    constraints = [LinearConstraint(matrix,np.array(lbs),np.array(ubs))]
    fuel_constraints = []
    if fuel_rows:
        fuel_r, fuel_c, fuel_v = [], [], []
        for row, terms in enumerate(fuel_rows):
            for col, value in terms:
                fuel_r.append(row); fuel_c.append(col); fuel_v.append(value)
        fuel_matrix = coo_matrix(
            (fuel_v,(fuel_r,fuel_c)), shape=(len(fuel_rows),count)).tocsc()
        fuel_constraints = [LinearConstraint(
            fuel_matrix, np.zeros(len(fuel_rows)), np.full(len(fuel_rows), np.inf))]
    objective = np.zeros(count); objective[4*size:4*size+2*h] = 1
    # [포크] 연간 계획은 창이 365개라 허용 간격을 인자로 받는다(원천 고정값 0.001 이 기본).
    options = {'time_limit':time_limit,'mip_rel_gap':mip_rel_gap, **(highs_options or {})}
    # `mip_heuristic_effort` 를 올려 보았지만(0.5) 앞단은 한 걸음도 나아가지 않았다 --
    # 2026-09-22 입력으로 기본값과 **초 단위까지 같은 답**이었다(361.2초 대 360.8초, 둘 다
    # 실패). 모자란 것은 탐색의 열의가 아니라 시간이다. `CENTRAL_TIME_LIMIT_SECONDS` 참고.
    # 비용 최소화는 따로 잰다. 실현가능 해를 찾는 것과 **싼 해를 찾는 것**은 같은 난이도가
    # 아닌데 지금까지 같은 60초를 받았고, 2026-09-16~18 의 저장된 실행 10건 중 9건에서
    # 비용 풀이가 시간 안에 아무것도 못 냈다. 그 답들은 '덜 싼 답' 이 아니라 **비용을 한 번도
    # 보지 않은 답**이다: 09-20 12시에 91원짜리 당진9를 세워 두고 104~107원짜리를 돌렸다.
    # HiGHS 기본값 0.05 는 노드의 5% 만 발견적 탐색에 쓴다. 증명된 최적해가 아니라 **싼 해를
    # 하나라도** 원하는 자리이므로 그 비율을 올린다. scipy 가 모르는 옵션은 HiGHS 로 그대로
    # 넘어간다(2026-09-21 확인). 2026-09-21 측정: 0.05 로는 300초에 실현가능점 0개
    # (HiGHS status 13, primal_status None).
    cost_options = {**options,
                    'time_limit': time_limit if cost_time_limit is None else cost_time_limit}
    money = np.zeros(count)
    money[:size] = costs.reshape(-1)*1000
    if no_load_won is not None:
        # [포크] 운전 중 고정비(원/h). 2차 연료곡선을 최소~최대 할선 하나로 놓으면 비용 = 기울기×P +
        # 절편×u 이고, 절편 몫을 여기서 u 에 싣는다. 연료곡선 보조변수 없이 같은 할선 근사가 된다.
        money[size:2*size] += np.broadcast_to(np.asarray(no_load_won, float), (h, n)).reshape(-1)
    if quadratic is not None:
        money[:size] = 0
        money[cost_start:reserve_start] = 1e6
    money[reserve_start:] = RESERVE_SHORTFALL_WON_PER_MW
    money[2*size:3*size] = start_cost.reshape(-1)
    money[3*size:4*size] = shutdown_cost
    if reference is not None and inertia_won > 0:
        # |u - ref| 는 ref 가 0/1 이면 u(1-2ref) + ref 로 선형이다. 상수 ref 는 빼도 같다.
        known = np.isfinite(reference).reshape(-1)
        money[size:2*size][known] += inertia_won * (1 - 2 * reference.reshape(-1)[known])
    # 발전소 기수 목표의 벗어남은 예비력 부족분 자리 뒤에 있다 -- 위 줄이 그 자리까지 부족분 값으로
    # 채웠으니 되돌린다. 기수 벌점과 시각 벌점은 풀이를 기울이는 데만 쓰고 보고 비용에는 넣지 않는다.
    money[soft_start:count] = 0.0
    steer = money.copy()
    for k_, (_, _, penalty) in enumerate(soft_groups):
        base = soft_start + 2 * h * k_
        steer[base:base + 2 * h] = penalty
    if steer_start is not None:
        steer[2*size:3*size] += steer_start.reshape(-1)
        steer[3*size:4*size] += steer_stop.reshape(-1)
    if single_stage:
        # [포크] 연간 계획용 단일단계. 원천은 (정확해 탐색 → 슬랙 최소 → 비용) 세 번 푼다. 365개 창에서
        # 그 방식은 창마다 45~60초였다(2027-04 4일 실측). 여기서는 목표 불일치를 MWh 당
        # `slack_penalty_won` 으로 비용에 얹어 한 번에 푼다 -- 기동비(수천만~1억 원)보다 커서 맞출 수
        # 있으면 맞추고, 못 맞추면 그 양과 사유를 그대로 보고한다.
        peak = None
        peak_proved = True
        began = time.perf_counter()
        one = steer.copy()
        one[4*size:4*size+2*h] += slack_penalty_won
        # 원 단위 계수가 1e8 까지 커서 HiGHS 가 척도 경고를 낸다. 최적해는 그대로이고 간격 판정만 안정된다.
        one = one * objective_scale
        result = milp(one, integrality=integer, bounds=Bounds(lower, upper),
                      constraints=constraints+fuel_constraints, options=cost_options)
        cost_seconds = time.perf_counter() - began
        front_seconds = 0.0
        if result.x is None:
            return {'status': 'constraints_infeasible' if result.status == 2 else 'no_solution',
                    'message': '단일단계 풀이 해 없음: ' + result.message, 'has_plan': False}
        first = exact = result
        exact_found = bool(result.x[4*size:4*size+2*h].max() <= .01)
        cost_attempted = True
    else:
        peak_proved=True
        # First seek an exactly balanced incumbent. Keep it if the later cost solve times out.
        exact_upper=upper.copy()
        exact_upper[4*size:cost_start]=0
        front_began = time.perf_counter()
        exact=milp(np.zeros(count),integrality=integer,bounds=Bounds(lower,exact_upper),constraints=constraints,options=options)
        if exact.x is None and exact.status != 2 and allow_approximate:
            exact=milp(np.zeros(count),integrality=integer,bounds=Bounds(lower,exact_upper),constraints=constraints,
                       options={**options,'time_limit':time_limit*2})
        exact_found=exact.x is not None
        if exact_found:
            upper=exact_upper
            first=exact
        elif allow_approximate:
            # A peak-only incumbent can be arbitrarily bad everywhere else.  Weight one MW of peak
            # mismatch like one MW at every hour, so even a time-limited incumbent remains a usable
            # whole-horizon plan instead of matching six extrema and abandoning everything between.
            peak_objective=np.zeros(count);peak_objective[peak_index]=h
            peak_objective[4*size:4*size+2*h] = 1
            peak=milp(peak_objective,integrality=integer,bounds=Bounds(lower,upper),constraints=constraints,options=options)
            if peak.x is None and peak.status != 2:
                peak=milp(peak_objective,integrality=integer,bounds=Bounds(lower,upper),
                          constraints=constraints,options={**options,'time_limit':time_limit*2})
            if peak.x is None:
                return {'status':'constraints_infeasible' if peak.status==2 else 'no_solution',
                        'message':'운전제약 충돌 또는 시간 제한으로 해 없음: '+peak.message,'has_plan':False}
            peak_proved=bool(peak.success)
            if peak_proved:
                upper[peak_index]=float(peak.x[peak_index])+1e-5
            else:
                first=peak
        if not exact_found and peak_proved:
            first = milp(objective,integrality=integer,bounds=Bounds(lower,upper),constraints=constraints,options=options)
        if first.x is None and allow_approximate and not exact_found:
            first=peak
        front_seconds = time.perf_counter() - front_began
        if first.x is None:
            return {'status':'target_infeasible' if first.status == 2 else 'no_solution',
                    'message':first.message, 'has_plan':False}
        # Only lock the slack optimum when proved, otherwise report the incumbent.
        slack_bound = float(objective @ first.x) + 1e-5
        constraints.append(LinearConstraint(coo_matrix(objective.reshape(1,-1)).tocsc(),-np.inf,slack_bound))
        # `first.success` 가 아니면 비용 풀이를 아예 건너뛴다 -- 슬랙 하한이 증명되지 않은 채로
        # 비용을 최소화하면 슬랙을 늘려 돈을 아끼는 답이 나온다. 건너뛴 것과 돌았지만 못 낸 것은
        # 고치는 방법이 다르므로 둘을 구분해 적는다.
        cost_attempted = bool(first.success)
        began = time.perf_counter()
        result = (milp(steer,integrality=integer,bounds=Bounds(lower,upper),
                       constraints=constraints+fuel_constraints,options=cost_options)
                  if cost_attempted else first)
        cost_seconds = time.perf_counter() - began
    x = result.x if result.x is not None else first.x
    shortage, excess = x[4*size:4*size+h], x[4*size+h:4*size+2*h]
    target_met=bool(max(shortage.max(),excess.max())<=.01)
    online = x[size:2*size].reshape(h,n) > .5
    power = x[:size].reshape(h,n)
    if quadratic is not None:
        # Feasibility incumbents need not minimise epigraph variables. Re-evaluate costs.
        a,b,c = np.moveaxis(quadratic, -1, 0)
        exact_fuel = float(((a*power**2+b*power+c)*online).sum())
        fuel = 0.0
        for t in range(h):
            for j in range(n):
                if not online[t,j]:
                    continue
                knots = np.linspace(minimum[t,j],maximum[t,j],fuel_segments+1)
                aa,bb,cc = quadratic[t,j]
                fuel += max((aa*(l+r)+bb)*power[t,j]+cc-aa*l*r
                            for l,r in zip(knots[:-1],knots[1:]))
    else:
        fuel = float(money[:size]@x[:size])
        exact_fuel = fuel
    # 해가 지는 시간의 부족은 "결합 제약" 이 아니라 대개 한 가지 사실이다: 낮에 세운 호기가
    # 최소 정지시간이 끝나지 않아 돌아오지 못한다. 그것을 '개별 원인 미확정' 으로 적으면
    # 운영자는 고칠 수 없는 것을 고치려 든다. 풀린 해에서 그 두 값은 실제로 셀 수 있다.
    blocked_mw,ramped_mw=_withheld_capacity(power,online,maximum,ramp_up,outage,initial,p0,elapsed,down)
    reasons=[]
    for t in range(h):
        if max(shortage[t],excess[t])<=.01:
            continue
        available=float((maximum[t]*~outage[t]).sum())
        floor=float((minimum[t]*must[t]*~outage[t]).sum())
        if target[t]>available+.01:
            code='available_maximum_below_target'
        elif target[t]<floor-.01:
            code='must_run_minimum_above_target'
        elif shortage[t]>.01 and blocked_mw[t]>=shortage[t]-.01:
            code='minimum_downtime_blocks_restart'
        elif shortage[t]>.01 and ramped_mw[t]>=shortage[t]-.01:
            code='ramp_rate_below_required_climb'
        else:
            code='coupled_operating_constraints'
        detail={'available_maximum_below_target':'정비 제외 최대공급능력이 목표보다 작음',
                'must_run_minimum_above_target':'필수운전 최소출력이 목표보다 큼',
                'minimum_downtime_blocks_restart':
                    f'앞서 정지한 호기가 최소 정지시간 중 — 재기동 가능했다면 {blocked_mw[t]:,.0f} MW',
                'ramp_rate_below_required_climb':
                    f'운전 중 호기가 출력변동률 상한 — 변동률이 없었다면 {ramped_mw[t]:,.0f} MW',
                'coupled_operating_constraints':
                    '최소 운전·정지시간, 출력변동률, 지역상한의 결합 또는 계산 시간제한 · 개별 원인 미확정'}[code]
        if code=='coupled_operating_constraints' and shortage[t]>.01:
            # 개별 원인을 못 짚어도 센 값은 준다 -- 둘 다 부족분에 못 미친다는 사실 자체가 근거다.
            detail+=f' (정지시간 묶임 {blocked_mw[t]:,.0f} MW, 변동률 묶임 {ramped_mw[t]:,.0f} MW)'
        reasons.append(dict(hour_index=t,code=code,target_mw=float(target[t]),
            shortage_mw=float(shortage[t]),excess_mw=float(excess[t]),
            restart_blocked_mw=float(blocked_mw[t]),ramp_blocked_mw=float(ramped_mw[t]),
            detail=detail))
    terminal_remaining = []
    for j in range(n):
        transitions = np.flatnonzero(np.diff(np.r_[initial[j], online[:,j]]))
        age = h - int(transitions[-1]) if len(transitions) else elapsed[j] + h
        terminal_remaining.append(float(max(0, (up[j] if online[-1,j] else down[j]) - age)))
    return {'status':'approximate' if not target_met else
            ('optimal' if peak_proved and first.success and result.success else 'time_limit_feasible'),
            'target_met':target_met,'mismatch_reasons':reasons,
            'exact_feasibility':'found' if exact_found else 'infeasible' if exact.status==2 else 'time_limit',
            'cost_optimal':bool(result.success),
            'cost_solve_attempted':cost_attempted,
            'cost_solve_returned':bool(cost_attempted and result.x is not None),
            'cost_time_limit_seconds':float(cost_options['time_limit']),
            'cost_solve_seconds':float(cost_seconds),
            'front_solve_seconds':float(front_seconds),
            'peak_optimal':peak_proved,
            'cost_won':fuel+float(money[2*size:4*size]@x[2*size:4*size]), 'mip_gap':float(result.mip_gap) if result.x is not None else None,
            'has_plan':True,
            'fuel_cost_won':fuel,
            'fuel_cost_exact_curve_won':exact_fuel,
            'fuel_cost_approximation_error_won':fuel-exact_fuel,
            'fuel_cost_model':f'quadratic_{fuel_segments}_segment' if quadratic is not None else 'linear_unit_price',
            'startup_cost_total_won':float(money[2*size:3*size]@x[2*size:3*size]),
            'initial_output_mw':p0.tolist(),'initial_target_mw':needed,
            'initial_online':initial.tolist(),
            'minimum_downtime_hours':down.tolist(),
            'initial_state_source':('provided' if pinned is not None and known.all()
                                    else 'partial' if pinned is not None else 'estimated'),
            'initial_state_known_units':int(known.sum()) if pinned is not None else 0,
            'initial_elapsed_hours':elapsed.tolist(),
            'terminal_minimum_remaining_hours':terminal_remaining,
            'output_mw':x[:size].reshape(h,n).tolist(),
            'online':(x[size:2*size].reshape(h,n)>.5).tolist(),
            'starts':(x[2*size:3*size].reshape(h,n)>.5).tolist(),
            'stops':(x[3*size:4*size].reshape(h,n)>.5).tolist(),
            'shortage_mw':shortage.tolist(),'excess_mw':excess.tolist(),
            'online_target_deviation':[float(x[soft_start + 2*h*k_:soft_start + 2*h*(k_+1)].sum())
                                       for k_ in range(len(soft_groups))],
            'reserve_shortfall_mw':(x[reserve_start:reserve_start+h].tolist() if reserve is not None
                                    else [0.0]*h),
            'slack_optimal':exact_found or (bool(first.success) and (not allow_approximate or first is not peak)),
            'assumptions':([f'초기 운전상태·출력·경과시간: {int(known.sum())}/{n}기 입력값'
                            + (f' · 나머지 {n - int(known.sum())}기 추정' if not known.all() else '')]
                           if pinned is not None else
                ['초기 운전·정지 경과시간 충족 가정', '초기 출력은 첫 계산구간 진입 직전 추정값']) + [
                '최소정지: 계통분리~재병입, 시간 단위 올림',
                '전망 밖 운전 약속 및 시간 내 기동·감발 곡선 미검증']}
