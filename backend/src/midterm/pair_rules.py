"""거래소 페어발전기·대단위 발전단지 기동·정지 기준 -- MILP 가 지켜야 할 호기 묶음 규칙.

national-solar-forecast `dss.pair_rules` 와 같은 값이다(2026-11-24 이식).

출처는 거래소 공문 「페어발전기 기동·정지 간격 / 대단위 발전단지 기동·정지 그룹」(10/1 이후 기준).
네 가지를 담는다.

1. **페어 간격**: 스팀·보조계통을 나누는 두 호기는 정해진 시간 이상 떨어져 기동하고 정지한다. 기동 간격은
   기동 직전 정지시간에 따라 DSS·Warm·Cold 값이 다르다. 정지 간격 0 은 동시 정지 가능이다(영흥).
2. **그룹 최소호기**: 6대 이상 단지는 그룹마다 한 대를 남긴다(태안·당진 1~4 / 5~10, 보령 3~6 / 7~8 ...).
3. **그룹 동시 정지**: 같은 그룹에서 한 시각에 세우는 대수 ≤ 내림(직전 운전 대수 / 2) -- 보조스팀.
4. **기동 방안**: 6대 그룹(태안·당진 5~10)은 가운데 7~8 을 거쳐 반대쪽 끝을 켜고, 그룹 안 기동 사이에
   태안 3시간·당진 2시간을 둔다. 하동 1~8 은 한 시각에 세 대까지 켠다. 여수는 2호기 → 1호기 순으로 켠다.

이 규칙이 없던 MILP 는 하루 0.9~2.6 건씩 페어 기동 간격을 어겼다(2026-02~07 · 09 소급, 삼천포·동해·하동·
강릉안인 등). 같은 기간 실적은 180일에 8건이었고 모두 기준 4시간에 2~3시간이었다 -- 실제 운영이 따르는
규칙이다.

`uc.solve_coal_uc` 는 호기 이름을 모른다. 여기서 이름을 index 로 바꾼다. 이름에 없는 호기는 빼고,
한쪽만 있는 페어는 건너뛴다(정비·폐지로 순위표에 없는 호기).
"""

from collections.abc import Sequence
from dataclasses import dataclass

from midterm.units import canonical_unit_name

#: 기동 직전 정지시간으로 DSS·Warm·Cold 를 가른다. 공문은 세 값만 주고 경계는 주지 않는다 -- 가정이다.
#: 하루 안 재기동(500MW급 최소정지 12시간, 1000MW급 18시간 포함)은 DSS, 사흘 넘게 섰다 켜면 Cold.
WARM_AFTER_HOURS = 24.0
COLD_AFTER_HOURS = 72.0


@dataclass(frozen=True)
class Pair:
    plant: str
    units: tuple[int, int]
    #: 기동 간격(시간): DSS · Warm · Cold
    start_hours: tuple[float, float, float]
    #: 정지 간격(시간). 0 은 동시 정지 가능.
    stop_hours: float


def _pairs(plant, numbers, start_hours, stop_hours):
    return tuple(Pair(plant, units, start_hours, stop_hours) for units in numbers)


_ONE_SIX = 8 + 10 / 60  # 8시간 10분

PAIRS: tuple[Pair, ...] = (
    *_pairs("여수", ((1, 2),), (10, 10, 11), 60),
    *_pairs("동해", ((1, 2),), (20, 20, 40), 2),
    *_pairs("태안", ((1, 2), (3, 4), (5, 6), (7, 8)), (4, 4, 5), 2),
    *_pairs("당진", ((1, 2), (3, 4), (5, 6), (7, 8)), (4, 4, 4), 2),
    *_pairs("보령", ((3, 4), (5, 6), (7, 8)), (3, 3, 3), 2),
    *_pairs("삼천포", ((3, 4),), (7, 7, 28), 26),
    *_pairs("삼천포", ((5, 6),), (4, 4, 6), 2),
    *_pairs("하동", ((1, 2), (3, 4), (5, 6), (7, 8)), (4, 4, 4), 2),
    *_pairs("북평", ((1, 2),), (4, 5, 9), 2),
    *_pairs("영흥", ((1, 2),), (9, 9, 16), 0),
    *_pairs("영흥", ((3, 4),), (4, 4, 8), 0),
    *_pairs("영흥", ((5, 6),), (5, 5, 9), 0),
    *_pairs("당진", ((9, 10),), (5, 5, 5), 2),
    *_pairs("태안", ((9, 10),), (6, 6, 8), 3),
    *_pairs("삼척그린", ((1, 2),), (22, 22, 24), 3),
    *_pairs("신보령", ((1, 2),), (10, 14, 33), 10),
    *_pairs("고성", ((1, 2),), (6.5, 6.5, _ONE_SIX), 2),
    *_pairs("삼척화력", ((1, 2),), (6.5, 6.5, _ONE_SIX), 2),
    *_pairs("강릉안인", ((1, 2),), (6.5, 6.5, _ONE_SIX), 2),
)


@dataclass(frozen=True)
class StartStopGroup:
    plant: str
    units: tuple[int, ...]
    #: 최소호기. 0 이면 없음(영흥 5~6).
    least_online: int
    #: 한 시각 동시 정지 ≤ 내림(직전 운전 대수 / 2). 영흥 5~6 은 동시 정지 가능이라 걸지 않는다.
    stop_halving: bool = True

    @property
    def label(self) -> str:
        return f"{self.plant}{self.units[0]}~{self.units[-1]}"


GROUPS: tuple[StartStopGroup, ...] = (
    StartStopGroup("태안", (1, 2, 3, 4), 1),
    StartStopGroup("태안", (5, 6, 7, 8, 9, 10), 1),
    StartStopGroup("당진", (1, 2, 3, 4), 1),
    StartStopGroup("당진", (5, 6, 7, 8, 9, 10), 1),
    StartStopGroup("보령", (3, 4, 5, 6), 1),
    StartStopGroup("보령", (7, 8), 1),
    StartStopGroup("하동", (1, 2, 3, 4), 1),
    StartStopGroup("하동", (5, 6, 7, 8), 1),
    StartStopGroup("삼천포", (3, 4, 5, 6), 1),
    StartStopGroup("영흥", (1, 2, 3, 4), 1),
    StartStopGroup("영흥", (5, 6), 0, stop_halving=False),
)


@dataclass(frozen=True)
class SixUnitGroup:
    """500MW 4대 + 1000MW 2대 그룹. 최소호기의 스팀이 가운데를 거쳐야 반대쪽 끝에 닿는다."""

    plant: str
    ends: tuple[tuple[int, int], tuple[int, int]]
    middle: tuple[int, int]
    #: 그룹 안 기동 사이 시간 -- 페어 간격과 따로 건다.
    start_spacing_hours: float


SIX_UNIT_GROUPS: tuple[SixUnitGroup, ...] = (
    SixUnitGroup("태안", ((5, 6), (9, 10)), (7, 8), 3),
    SixUnitGroup("당진", ((5, 6), (9, 10)), (7, 8), 2),
)

#: (발전소, 호기, 한 시각 최대 기동 대수) -- 하동은 기동유 압력 부족으로 8대 중 세 대까지.
START_CAPS: tuple[tuple[str, tuple[int, ...], int], ...] = (("하동", (1, 2, 3, 4, 5, 6, 7, 8), 3),)

#: (발전소, 먼저 켤 호기, 그 다음 호기)
START_ORDER: tuple[tuple[str, int, int], ...] = (("여수", 2, 1),)


def _index(names: Sequence[str]) -> dict[str, int]:
    return {canonical_unit_name(name): j for j, name in enumerate(names)}


def transition_rules(names: Sequence[str]) -> dict:
    """`solve_coal_uc(transition_rules=...)` 에 넘길 index 규칙. 최소호기는 `group_minimums` 가 따로 낸다."""
    index = _index(names)

    def present(plant, numbers):
        return [index[f"{plant}{u}"] for u in numbers if f"{plant}{u}" in index]

    pairs = []
    for pair in PAIRS:
        found = present(pair.plant, pair.units)
        if len(found) == 2:
            pairs.append({"indices": tuple(found), "start_hours": pair.start_hours,
                          "stop_hours": float(pair.stop_hours),
                          "label": f"{pair.plant}{pair.units[0]}·{pair.units[1]}"})
    stop_limits = [{"indices": found, "label": group.label} for group in GROUPS
                   if group.stop_halving and len(found := present(group.plant, group.units)) >= 2]
    spacing, bridges = [], []
    for group in SIX_UNIT_GROUPS:
        members = present(group.plant, group.ends[0] + group.middle + group.ends[1])
        if len(members) >= 2:
            spacing.append({"indices": members, "hours": float(group.start_spacing_hours),
                            "label": f"{group.plant}{group.ends[0][0]}~{group.ends[1][1]}"})
        bridge = present(group.plant, group.middle)
        for end in group.ends:
            for number in end:
                if f"{group.plant}{number}" not in index:
                    continue
                partner = [u for u in end if u != number]
                bridges.append({"unit": index[f"{group.plant}{number}"], "bridge": bridge,
                                "also": present(group.plant, partner)})
    caps = [{"indices": found, "maximum": maximum, "label": f"{plant}{units[0]}~{units[-1]}"}
            for plant, units, maximum in START_CAPS if len(found := present(plant, units)) > maximum]
    order = [{"first": index[f"{plant}{first}"], "then": index[f"{plant}{then}"],
              "label": f"{plant}{first}→{then}"}
             for plant, first, then in START_ORDER
             if f"{plant}{first}" in index and f"{plant}{then}" in index]
    return {"pairs": pairs, "warm_after_hours": WARM_AFTER_HOURS, "cold_after_hours": COLD_AFTER_HOURS,
            "group_stop_limits": stop_limits, "group_start_spacing": spacing,
            # 가운데(7~8)가 순위표에 없으면 기동 순서를 묻지 않는다 -- 길이 없는 것이지 막힌 것이 아니다.
            "start_bridges": [b for b in bridges if b["bridge"]],
            "group_start_caps": caps, "start_order": order}


def group_minimums(names: Sequence[str], outage) -> list[dict]:
    """그룹 최소호기를 `group_online_minimums` 모양으로. 시각마다 정비 아닌 호기 수까지만 요구한다.

    national-solar-forecast `jobs.coal_uc_comparison.plant_group_minimums` 와 같은 열쇠(plant·index·units·minimum·
    minimum_units_hourly)를 쓴다 -- 같은 자리에 섞어 넘긴다.
    """
    index = _index(names)
    out = []
    for group in GROUPS:
        found = [index[f"{group.plant}{u}"] for u in group.units if f"{group.plant}{u}" in index]
        if not found or group.least_online <= 0:
            continue
        hourly = [min(group.least_online, sum(1 for j in found if not row[j])) for row in outage]
        out.append({"plant": group.plant, "group": group.label, "minimum": group.least_online,
                    "index": found, "units": [names[j] for j in found], "minimum_units_hourly": hourly,
                    "rule": f"{group.label} 중 {group.least_online}대 이상(정비 가용대수로 제한)",
                    "basis": "거래소 대단위 발전단지 기동·정지 그룹 최소호기"})
    return out
