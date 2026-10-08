"""공유한 실행 스냅샷의 파일 크기와 SHA-256을 확인한다. 운영 원장을 수정하지 않는다."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "shared-assets.json").read_text(encoding="utf-8"))
    failures = []
    for item in manifest["files"]:
        path = root / item["path"]
        if not path.is_file():
            failures.append(f"missing: {item['path']}")
            continue
        content = path.read_bytes()
        if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
            failures.append(f"changed: {item['path']}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"Shared assets verified: {len(manifest['files'])} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
