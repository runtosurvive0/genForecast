"""Conservative destination hints, never a confirmed voyage or a cargo classifier.

Curated UN/LOCODE ports/locations: https://service.unece.org/trade/locode/kr.htm
Reviewed 2026-10-10. Not an exhaustive list; aliases are application-maintained.
"""
import re


PORTS = (
    ("KRTJI", "당진", ("DANGJIN", "TANGJIN", "당진")),
    ("KRBOR", "보령", ("BORYEONG", "BORYONG", "보령")),
    # HDG identifies Hadong-gun, not a verified terminal or harbour entrance.
    ("KRHDG", "하동 지역", ("HADONG", "HADONG GUN", "하동")),
    ("KRTAN", "태안", ("TAEAN", "TAEAN GUN", "태안")),
    ("KRTGH", "동해", ("DONGHAE", "TONGHAE", "동해")),
    ("KRPTK", "평택", ("PYEONGTAEK", "PYONGTAEK", "평택")),
    ("KRSUK", "삼척", ("SAMCHEOK", "SAMCHOK", "삼척")),
    ("KRPUS", "부산", ("BUSAN", "PUSAN", "부산")),
    ("KRBNP", "부산신항", ("BUSAN NEW PORT", "PUSAN NEW PORT", "부산신항")),
    ("KRINC", "인천", ("INCHEON", "INCHON", "인천")),
    ("KRMAS", "마산", ("MASAN", "마산")),
    ("KRUSN", "울산", ("ULSAN", "울산")),
    ("KRKAN", "광양", ("GWANGYANG", "KWANGYANG", "광양")),
    ("KRYOS", "여수", ("YEOSU", "YOSU", "여수")),
    ("KRKPO", "포항", ("POHANG", "포항")),
    ("KRSCP", "삼천포", ("SAMCHEONPO", "SAMCHONPO", "삼천포")),
    ("KRHAS", "호산", ("HOSAN", "호산")),
)
COUNTRIES = ("SOUTH KOREA", "S KOREA", "REPUBLIC OF KOREA", "KOREA", "KOR", "KR")


def korean_destination(raw):
    if not isinstance(raw, str) or len(raw) > 100:
        return None
    value = raw.replace("@", "").strip().upper()
    # An explicit direction selects the terminal destination, never the origin.
    value = re.split(r"\s*(?:->|>|→|\bTO\b)\s*", value)[-1]
    value = re.sub(r"[,.()]", " ", value)
    value = " ".join(value.split())
    for country in COUNTRIES:
        if value.endswith(" " + country):
            value = value[:-(len(country) + 1)].strip()
            break
    for code, name, aliases in PORTS:
        if value in (code, code[:2] + " " + code[2:]):
            return {"portCode": code, "portName": name, "matchedBy": "code"}
        if value in aliases:
            return {"portCode": code, "portName": name, "matchedBy": "name"}
    return None
