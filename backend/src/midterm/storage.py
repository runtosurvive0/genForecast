"""CSV 표와 그 JSON 사본.

이 PC 에서는 `.csv`·`.xlsx` 가 디스크 전체에서 주기적으로 지워진다(2026-10-04 18:31: 이 프로젝트의
data/·inputs/ CSV 와 결과 엑셀, 원천 national-solar-forecast 의 CSV·XLSX 가 같은 시각에 모두 사라짐.
.json·.npz·.txt 는 남음). 사람이 고치는 자료는 CSV 로 두고 싶으므로, 읽고 쓸 때마다 같은 이름의 `.json`
사본을 맞춰 두고 CSV 가 없으면 사본에서 되살린다. 사본은 CSV 를 마지막으로 읽은 때의 내용이다 -- CSV
를 고친 뒤 한 번도 읽기 전에 지워지면 그 수정은 잃는다.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path


def mirror_of(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".json")


def write_table(path: Path, columns: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clean = [{c: ("" if row.get(c) is None else str(row.get(c))) for c in columns} for row in rows]
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, columns)
        writer.writeheader()
        writer.writerows(clean)
    mirror_of(path).write_text(json.dumps({"columns": columns, "rows": clean}, ensure_ascii=False),
                               encoding="utf-8")


def read_table(path: Path) -> list[dict]:
    """CSV 를 읽고 사본을 맞춘다. CSV 가 없으면 사본에서 읽고 CSV 를 되살린다."""
    path = Path(path)
    mirror = mirror_of(path)
    if path.exists():
        with path.open(encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            rows = [dict(row) for row in reader]
            columns = list(reader.fieldnames or [])
        payload = json.dumps({"columns": columns, "rows": rows}, ensure_ascii=False)
        if not mirror.exists() or mirror.read_text(encoding="utf-8") != payload:
            mirror.write_text(payload, encoding="utf-8")
        return rows
    if mirror.exists():
        data = json.loads(mirror.read_text(encoding="utf-8"))
        try:
            write_table(path, data["columns"], data["rows"])
        except OSError:
            pass
        return [dict(row) for row in data["rows"]]
    raise FileNotFoundError(f"{path} 와 그 사본 {mirror.name} 이 모두 없습니다")


def exists(path: Path) -> bool:
    return Path(path).exists() or mirror_of(Path(path)).exists()
