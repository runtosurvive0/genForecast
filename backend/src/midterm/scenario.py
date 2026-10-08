"""연간 실행 한 번의 입력 묶음(시나리오). JSON 으로 저장·재현한다."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from midterm.outages import Outage, load_outages

ROOT = Path(__file__).resolve().parents[2]

#: 풀이 품질 단계. 창(48시간)마다 시간한도(초)와 허용 상대간격.
QUALITY = {"fast": (12.0, 0.02), "normal": (30.0, 0.005), "precise": (90.0, 0.001)}


@dataclass(slots=True)
class Scenario:
    name: str = "기본"
    start: date = date(2027, 1, 1)
    end: date = date(2027, 12, 31)
    #: "normal" = 평년기상, 정수 = 그 해의 실측 기상(기온·태양광)을 재생
    weather: str | int = "normal"
    #: None 이면 학습자료에서 잰 값(기온보정 전년비)
    demand_growth_pct: float | None = None
    solar_growth_pct: float | None = None
    #: 월별 석탄목표 보정(%). 석탄곡선 모델은 2026-01~09 로만 학습돼 10~12월을 본 적이 없다.
    coal_adjust_pct: list[float] = field(default_factory=lambda: [0.0] * 12)
    #: 석탄 목표의 이 비율만큼 켜 둔 호기 최대출력 여유를 둔다(원천 기본 0.12, 소프트 제약).
    reserve_ratio: float = 0.12
    quality: str = "normal"
    workers: int | None = None
    nuclear_oh: list[Outage] = field(default_factory=list)
    coal_oh: list[Outage] = field(default_factory=list)

    @property
    def days(self) -> list[date]:
        from datetime import timedelta
        return [self.start + timedelta(days=i) for i in range((self.end - self.start).days + 1)]

    def to_json(self) -> dict:
        data = asdict(self)
        data["start"], data["end"] = self.start.isoformat(), self.end.isoformat()
        data["nuclear_oh"] = [o.as_row() for o in self.nuclear_oh]
        data["coal_oh"] = [o.as_row() for o in self.coal_oh]
        return data

    @classmethod
    def from_json(cls, data: dict) -> "Scenario":
        from midterm.outages import parse_outage_rows
        rows = lambda key: ([["unit", "start", "end", "note"]]  # noqa: E731
                            + [[r["unit"], r["start"], r["end"], r.get("note", "")]
                               for r in data.get(key, [])])
        weather = data.get("weather", "normal")
        return cls(
            name=data.get("name", "기본"),
            start=date.fromisoformat(data["start"]), end=date.fromisoformat(data["end"]),
            weather=weather if weather == "normal" else int(weather),
            demand_growth_pct=data.get("demand_growth_pct"),
            solar_growth_pct=data.get("solar_growth_pct"),
            coal_adjust_pct=list(data.get("coal_adjust_pct") or [0.0] * 12),
            reserve_ratio=float(data.get("reserve_ratio", 0.12)),
            quality=data.get("quality", "normal"), workers=data.get("workers"),
            nuclear_oh=parse_outage_rows(rows("nuclear_oh")),
            coal_oh=parse_outage_rows(rows("coal_oh")))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "Scenario":
        return cls.from_json(json.loads(Path(path).read_text(encoding="utf-8")))


def default_scenario() -> Scenario:
    """기본 입력: 2027년, 원전정비는 KPX 2026-10 계획에서 2027년까지 이어지는 7건, 석탄정비 없음."""
    from midterm.outages import parse_outage_rows
    from midterm.storage import exists, read_table

    def rows(path: Path):
        if not exists(path):
            return []
        table = read_table(path)
        return parse_outage_rows([["unit", "start", "end", "note"]] + [
            [r.get("unit", ""), r.get("start", ""), r.get("end", ""), r.get("note", "")] for r in table])

    return Scenario(nuclear_oh=rows(ROOT / "inputs" / "nuclear_oh_2027.csv"),
                    coal_oh=rows(ROOT / "inputs" / "coal_oh_2027.csv"))
