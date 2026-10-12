"""Bounded map representation of the committed catalog. No AIS subscription per viewer."""
import json
from math import floor, isfinite
from .navigation import epoch


def retained(rank, metadata, now):
    return rank is not None or metadata is not None and 0 <= epoch(now)-epoch(json.loads(metadata)['destinationObservedAt']) < 72*3600


def vessel_detail(store, mmsi, now):
    row = store.find(mmsi)
    if row and retained(row[2], row[4], now):
        return json.loads(row[1])
    return None


def fleet_map(store, west, east, south, north, zoom, now):
    rows, stamp = store.load()
    points = []
    for _, raw, rank, _, metadata in rows:
        if not retained(rank, metadata, now):
            continue
        v = json.loads(raw)
        ais = v.get('ais') or {}
        p = ais.get('position') or {}
        lon, lat = p.get('longitude'), p.get('latitude')
        if not all(isinstance(n, (int, float)) and not isinstance(n, bool) and isfinite(n) for n in (lon, lat)):
            continue
        if not -180 <= lon <= 180 or not south <= lat <= north:
            continue
        if not (west <= lon <= east if west <= east else lon >= west or lon <= east):
            continue
        try:
            age = epoch(now)-epoch(p['observedAt'])
        except (ValueError, KeyError, TypeError):
            continue
        if age < 0:
            continue
        course = p.get('cogDeg')
        speed = p.get('sogKn')
        moving = isinstance(speed, (int, float)) and .5 <= speed < 102.3 and ais.get('navStatus') not in (1, 5, 6)
        course = course if moving and isinstance(course, (int, float)) and 0 <= course < 360 else None
        points.append((lon, lat, {'kind': 'vessel', 'mmsi': v['mmsi'], 'name': v['name'],
                                  'count': 1, 'course': course, 'fresh': age <= 3600}))
    # At harbour scale expose co-located identities individually. The accessible
    # selector can reach each ship even where its pixels overlap another ship.
    if zoom >= 14 and len(points) <= 1200:
        return {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': props['mmsi'], 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
             'properties': props} for lon, lat, props in points], 'visibleCount': len(points),
            'lastReceivedAt': stamp, 'fetchedAt': now, 'positionBasis': 'last-observation'}
    # Fixed geographic cells remain stable while panning. Coarsen until response is bounded.
    cell = 22.5 / 2**max(-2, min(18, zoom))
    while True:
        buckets = {}
        for lon, lat, props in points:
            x = lon if west <= east or lon >= west else lon + 360
            key = (floor((x+180)/cell), floor((lat+90)/cell))
            buckets.setdefault(key, []).append((x, lat, props))
        if len(buckets) <= 1200:
            break
        cell *= 2
    features = []
    for key, values in sorted(buckets.items()):
        count = len(values)
        lon = (sum(v[0] for v in values)/count + 180) % 360 - 180
        lat = sum(v[1] for v in values)/count
        props = values[0][2] if count == 1 else {'kind': 'cluster', 'count': count,
            'fresh': any(v[2]['fresh'] for v in values), 'cellDegrees': cell}
        features.append({'type': 'Feature', 'id': props.get('mmsi', f'{cell}:{key}'),
                         'geometry': {'type': 'Point', 'coordinates': [lon, lat]}, 'properties': props})
    return {'type': 'FeatureCollection', 'features': features, 'visibleCount': len(points),
            'lastReceivedAt': stamp, 'fetchedAt': now, 'positionBasis': 'last-observation'}
