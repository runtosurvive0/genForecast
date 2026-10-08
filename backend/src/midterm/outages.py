"""연간 OH(계획예방정비) 계획 입력 -- 원전과 석탄 공통.

받는 형식 (CSV 또는 XLSX, 첫 시트):

1. 기본형: `unit,start,end[,note]` (한글 머리말 `호기,시작,종료,비고` 도 됨).
   날짜만 쓰면 시작일 0시 ~ 종료일 24시(**양끝 포함**). `2027-03-02 13:00` 처럼 시각을 쓰면
   그 시각 단위로 [시작, 종료) 이다.
2. 운영자 양식: 둘째 줄 첫 칸이 `자원명` 이고 `자원명, 설비용량, 시작 년,월,일, 종료 년,월,일`
   (Coal fuel forecast 프로젝트가 받던 `석탄 정비일정.csv`).

호기 이름은 `units.canonical_unit_name` 으로 접어 마스터와 맞춘다. 마스터에 없는 이름은 조용히
버리지 않고 오류로 돌려준다 -- 오타 하나로 정비가 빠진 채 1년이 풀리면 결과가 그럴듯하게 틀린다.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from midterm.units import canonical_unit_name

_HEADERS = {"unit": ("unit", "호기", "호기명", "발전기", "자원명"),
            "start": ("start", "시작", "시작일", "착수", "착수일"),
            "end": ("end", "종료", "종료일", "준공", "준공일"),
            "note": ("note", "비고", "내용", "구분")}


@dataclass(frozen=True, slots=True)
class Outage:
    unit: str              # 정규화된 이름
    start: datetime        # 포함
    end: datetime          # 제외
    note: str = ""

    def covers_hour(self, at: datetime) -> bool:
        return self.start <= at < self.end

    def as_row(self) -> dict:
        whole_days = self.start.hour == 0 and self.end.hour == 0
        return {"unit": self.unit,
                "start": self.start.date().isoformat() if whole_days else self.start.isoformat(" ", "minutes"),
                "end": ((self.end - timedelta(days=1)).date().isoformat() if whole_days
                        else self.end.isoformat(" ", "minutes")),
                "note": self.note}


def _parse_moment(value, *, is_end: bool) -> datetime:
    if isinstance(value, datetime):
        has_time = value.hour or value.minute
        moment = value.replace(second=0, microsecond=0)
        return moment if has_time or not is_end else moment + timedelta(days=1)
    if isinstance(value, date):
        return datetime.combine(value + timedelta(days=1 if is_end else 0), datetime.min.time())
    text = str(value).strip().replace(".", "-").replace("/", "-")
    if not text:
        raise ValueError("날짜가 비었습니다")
    if len(text) <= 10:
        day = date.fromisoformat("-".join(part.zfill(2) for part in text.split("-")))
        return _parse_moment(day, is_end=is_end)
    moment = datetime.fromisoformat(text.replace(" ", "T"))
    return _parse_moment(moment, is_end=is_end)


def _rows_from_file(path: Path) -> list[list]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl
        workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
        try:
            return [list(row) for row in workbook.worksheets[0].iter_rows(values_only=True)
                    if any(cell not in (None, "") for cell in row)]
        finally:
            workbook.close()
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    return parse_rows_text(text)


def parse_rows_text(text: str) -> list[list]:
    return [row for row in csv.reader(io.StringIO(text.lstrip("﻿")))
            if any(cell.strip() for cell in row)]


def _from_operator_form(rows: list[list]) -> list[Outage]:
    out = []
    for row in rows[2:]:
        if len(row) < 8 or not str(row[0]).strip():
            continue
        start = date(int(row[2]), int(row[3]), int(row[4]))
        end = date(int(row[5]), int(row[6]), int(row[7]))
        out.append(Outage(canonical_unit_name(row[0]), _parse_moment(start, is_end=False),
                          _parse_moment(end, is_end=True), "운영자 양식"))
    return out


def parse_outage_rows(rows: list[list]) -> list[Outage]:
    """행 목록(첫 행 머리말) → Outage 목록."""
    if not rows:
        return []
    if len(rows) > 1 and str(rows[1][0]).strip() == "자원명":
        return _from_operator_form(rows)
    header = [str(cell or "").strip().lower() for cell in rows[0]]
    index = {}
    for key, names in _HEADERS.items():
        for i, cell in enumerate(header):
            if cell in names:
                index[key] = i
                break
    if not {"unit", "start", "end"} <= set(index):
        raise ValueError("정비계획 머리말에 unit/start/end (호기/시작/종료) 열이 필요합니다")
    out = []
    for number, row in enumerate(rows[1:], start=2):
        unit = str(row[index["unit"]] or "").strip() if index["unit"] < len(row) else ""
        if not unit or unit.startswith("#"):
            continue
        try:
            start = _parse_moment(row[index["start"]], is_end=False)
            end = _parse_moment(row[index["end"]], is_end=True)
        except (ValueError, IndexError) as error:
            raise ValueError(f"{number}행 {unit}: 날짜를 읽을 수 없습니다 ({error})") from None
        if end <= start:
            raise ValueError(f"{number}행 {unit}: 종료가 시작보다 앞섭니다")
        note = (str(row[index["note"]] or "").strip()
                if "note" in index and index["note"] < len(row) else "")
        out.append(Outage(canonical_unit_name(unit), start, end, note))
    return out


def load_outages(path: Path) -> list[Outage]:
    return parse_outage_rows(_rows_from_file(Path(path)))


def save_outages(path: Path, outages: list[Outage]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, ["unit", "start", "end", "note"])
        writer.writeheader()
        for outage in outages:
            writer.writerow(outage.as_row())


def validate_units(outages: list[Outage], known: list[str], kind: str) -> list[str]:
    """마스터에 없는 호기 이름 목록(정규화 비교)."""
    folded = {canonical_unit_name(name) for name in known}
    return sorted({o.unit for o in outages if o.unit not in folded})


def outage_hours(outages: list[Outage], unit: str, hours: list[datetime]) -> list[bool]:
    mine = [o for o in outages if o.unit == canonical_unit_name(unit)]
    return [any(o.covers_hour(at) for o in mine) for at in hours]
