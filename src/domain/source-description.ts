/** Translate system-provided source descriptions without rewriting user records. */
export function sourceDescription(value: string): string {
  return value
    .replaceAll("1~4호기 처", "1저탄장")
    .replaceAll("5~8호기 처", "2저탄장")
    .replaceAll("9~10호기 처", "3저탄장")
    .replaceAll("사진", "참고 자료")
    .replace(/(?<![가-힣])합성/g, "시연")
    .replace(/더미(?=\s*(?:데이터|표본|AIS))/g, "시연")
    // 서버 문구의 " -- "는 문장 부호(마침표)로 읽히게 한다.
    .replace(/[.。]?\s+--\s+/g, ". ");
}
