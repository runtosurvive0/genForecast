"""호기 이름 정규화와 동해안 송전그룹.

같은 호기가 자료마다 다르게 적힌다: `당진#5`, `당진5호기`, `당진 5`, `당진본부 5호기`,
`신보령화력#1`, `삼척그린파워#2`. 사용자가 올린 정비계획을 호기 마스터에 붙이려면 한 이름으로
모아야 한다. 원자력은 마스터가 `한빛#1` 처럼 `#` 을 쓰므로 비교할 때만 같은 규칙으로 접는다.
"""

import re

#: 원천 `transmission_groups` 의 TRANSMISSION 그룹 -- 동해안 8기.
TRANSMISSION = "transmission"
EAST_COAST_PLANTS = ("강릉안인", "북평", "삼척그린", "삼척화력")

_ALIASES = (
    ("신보령화력", "신보령"),
    ("삼척그린파워", "삼척그린"),
    ("북평화력", "북평"),
    ("신서천화력", "신서천"),
    ("당진본부", "당진"),
    ("당진화력", "당진"),
)


def canonical_unit_name(raw: str) -> str:
    """`당진#5` · `당진5호기` · `당진본부 5호기` → `당진5`. `신서천화력1호기` → `신서천`."""
    name = str(raw).strip()
    for alias, canonical in _ALIASES:
        name = name.replace(alias, canonical)
    name = re.sub(r"\s+|#|호기$", "", name)
    name = re.sub(r"호기", "", name)
    if name.startswith("신서천"):
        return "신서천"
    return name


def group_of(name: str) -> str | None:
    plant = canonical_unit_name(name).rstrip("0123456789")
    return TRANSMISSION if plant in EAST_COAST_PLANTS else None


def plant_of(name: str) -> str:
    return canonical_unit_name(name).rstrip("0123456789")
