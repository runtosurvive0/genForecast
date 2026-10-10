"""Conservative AIS destination matching against searoute's bundled port data.

This identifies reported text, not a confirmed voyage, terminal or cargo contract.
"""
from functools import lru_cache
import re
from midterm.vessels.korean_destinations import korean_destination


def normalized(text):
    return ' '.join(text.replace('@', '').strip().upper().split())


@lru_cache(maxsize=1)
def port_catalog():
    import searoute
    result = {}
    duplicates = set()
    for (lon, lat), data in searoute.setup_P().nodes(data=True):
        code = data.get('port', '')
        if not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{3}', code):
            continue
        if code in result:
            duplicates.add(code)
        result[code] = {'name': data['name'], 'country': data.get('cty', ''),
                        'coordinates': [lon, lat]}
    # A code with multiple coordinates is not a safe automatic selection.
    return {code: port for code, port in result.items() if code not in duplicates}


def port_coordinates(destination):
    code = destination.removeprefix('port:')
    port = port_catalog().get(code) if destination.startswith('port:') else None
    if not port:
        raise ValueError('목적항 코드가 항만 자료에 없습니다.')
    return list(port['coordinates'])


def resolve_destination(raw):
    result = {'raw': raw, 'status': 'unresolved'}
    text = normalized(raw)
    if not text:
        return {**result, 'status': 'missing'}
    # Directional syntax is accepted; lists/alternatives and fuzzy guesses are not.
    text = re.split(r'\s*(?:->|>|→|\bTO\b)\s*', text)[-1]
    catalog = port_catalog()
    compact = text.replace(' ', '')
    if compact in catalog:
        codes, basis = [compact], 'code'
    else:
        korea = korean_destination(text)
        if korea and korea['portCode'] in catalog:
            codes, basis = [korea['portCode']], 'name'
        else:
            codes = [code for code, port in catalog.items() if normalized(port['name']) == text]
            basis = 'name'
    if len(codes) != 1:
        return {**result, 'status': 'ambiguous' if codes else 'unresolved'}
    code = codes[0]
    return {**result, 'status': 'resolved', 'destinationId': f'port:{code}',
            'code': code, 'name': catalog[code]['name'], 'country': catalog[code]['country'],
            'matchedBy': basis}
