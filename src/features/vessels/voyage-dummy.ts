/** 원장 화면의 더미 표시 판정. 백엔드 voyage_registry.dummy_keys()와 같은 규칙(단, 빈 문자열은 값 없음으로 봄)을 따른다. */
type Value = string | number | null | undefined;
type DummyRow = Record<string, Value>;
interface FieldLike {
  key: string;
  system?: boolean;
}

export const DUMMY_ROW_TITLE = "더미 자료(공개 일반값으로 생성)";
export const DUMMY_FIELD_TITLE = "빈칸을 더미로 채운 값";

/** 행 배지: data_origin이 dummy 또는 mixed인 행. */
export function isDummyRow(row: DummyRow): boolean {
  return row.data_origin === "dummy" || row.data_origin === "mixed";
}

/** 칸 배지: dummy 행은 키·system 칸을 뺀 값 있는 칸 전부, mixed 행은 dummy_fields 목록의 칸. */
export function dummyFieldKeys<F extends FieldLike>(row: DummyRow, fields: F[], key: string): Set<string> {
  if (row.data_origin === "dummy")
    return new Set(
      fields
        .filter((f) => f.key !== key && !f.system && row[f.key] !== null && row[f.key] !== undefined && row[f.key] !== "")
        .map((f) => f.key),
    );
  if (row.data_origin === "mixed")
    return new Set(
      String(row.dummy_fields ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    );
  return new Set();
}

export function isFieldDummy<F extends FieldLike>(row: DummyRow, fields: F[], key: string, field: string): boolean {
  return dummyFieldKeys(row, fields, key).has(field);
}

/** 편집기·상세 목록에서 서버 관리 칸(system)을 뺀다. */
export function visibleFields<F extends FieldLike>(fields: F[]): F[] {
  return fields.filter((f) => !f.system);
}

export function auditOriginLabel(origin: string): string {
  if (origin === "excel") return "엑셀";
  if (origin === "dummy-data") return "더미 적재";
  return "직접 입력";
}

/** 변경 이력의 before/after JSON. 삭제 기록('null')이나 깨진 값은 null로 돌려준다. */
export function parseAuditRow(value: string | null | undefined): Record<string, Value> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Value>) : null;
  } catch {
    return null;
  }
}
