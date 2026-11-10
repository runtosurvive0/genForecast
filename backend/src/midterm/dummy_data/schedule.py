"""Place dummy voyages on each berth in number order between the known schedule anchors."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from midterm.voyage_registry import KST

EVENTS = ('departure', 'arrival', 'berth', 'unload_end')
YEAR_START = datetime(2026, 1, 1, tzinfo=KST)
LAST_BLOCK_LEAD = timedelta(days=10)
BERTH_GAP = timedelta(hours=2)


@dataclass
class Slot:
    """What the scheduler needs to know about one voyage number."""
    serial: int
    dummy: bool
    actual: dict            # real actual_* datetimes by event (empty for dummy voyages)
    planned: dict           # real planned_* datetimes a person entered (empty for dummy voyages)
    duration: timedelta     # bl_t / unload_tph / work_hours_per_day × 24 h
    sailing: timedelta      # loading port → 당진
    jitter: timedelta       # U(−12 h, +12 h) on the interpolated arrival
    wait: timedelta         # U(2 h, 18 h) from arrival to berthing
    fixed_arrival: datetime | None = None  # a person's arrival time the dummy chain must start from


def parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value).astimezone(KST) if value else None


def iso(value: datetime) -> str:
    """KST ISO string rounded to the minute, the format the registry stores."""
    value = value.astimezone(KST)
    rounded = (value + timedelta(seconds=30)).replace(second=0, microsecond=0)
    return rounded.isoformat(timespec='seconds')


def anchors(slots: dict[int, Slot], last_serial: int, as_of: datetime) -> list[tuple[int, datetime]]:
    """Serial → arrival anchors: serial 0 at 1 Jan, real unload ends, the last real block at as_of − 10 days.

    Serials after the last anchor are spread up to as_of (implicit anchor at last_serial + 1)."""
    points = {0: YEAR_START}
    for serial, slot in slots.items():
        if not slot.dummy and slot.actual.get('unload_end'):
            points[serial] = slot.actual['unload_end']
    real = {s for s, slot in slots.items() if not slot.dummy}
    first = last_serial
    if last_serial in real:
        while first - 1 in real:
            first -= 1
    points.setdefault(first, as_of - LAST_BLOCK_LEAD)
    points.setdefault(last_serial + 1, as_of)
    kept: list[tuple[int, datetime]] = []
    for serial in sorted(points):
        if not kept or points[serial] > kept[-1][1]:
            kept.append((serial, points[serial]))
    return kept


def interpolate(points: list[tuple[int, datetime]], serial: int) -> datetime:
    for (s0, t0), (s1, t1) in zip(points, points[1:]):
        if s0 <= serial <= s1:
            return t0 + (t1 - t0) * ((serial - s0) / (s1 - s0))
    s0, t0 = points[-1]
    return t0 + timedelta(days=serial - s0)


def plan_berth(slots: dict[int, Slot], last_serial: int, as_of: datetime) -> dict[int, dict[str, datetime]]:
    """Proposed event times per serial. Dummy voyages never start unloading before the previous one ends."""
    points = anchors(slots, last_serial, as_of)
    times: dict[int, dict[str, datetime]] = {}
    previous_end: datetime | None = None
    for serial in sorted(slots):
        slot = slots[serial]
        if not slot.dummy and slot.actual.get('unload_end'):
            end = slot.actual['unload_end']
            berth = slot.actual.get('berth') or end - slot.duration
            arrival = slot.actual.get('arrival') or berth - slot.wait
            departure = slot.actual.get('departure') or arrival - slot.sailing
            previous_end = end
        elif not slot.dummy:
            # A real voyage that has not finished unloading only gets a planned departure and arrival.
            arrival = slot.planned.get('arrival') or interpolate(points, serial) + slot.jitter
            times[serial] = {'departure': arrival - slot.sailing, 'arrival': arrival}
            continue
        else:
            arrival = slot.fixed_arrival or interpolate(points, serial) + slot.jitter
            berth = arrival + slot.wait
            if previous_end is not None and berth < previous_end:
                berth = previous_end + BERTH_GAP
            end = berth + slot.duration
            departure = arrival - slot.sailing
            previous_end = end
        times[serial] = {'departure': departure, 'arrival': arrival, 'berth': berth, 'unload_end': end}
    # Round once, keeping the unloading duration exact to the minute after rounding the berthing time.
    out = {}
    for serial, events in times.items():
        rounded = {k: parse(iso(v)) for k, v in events.items()}
        if 'unload_end' in events and slots[serial].dummy:
            rounded['unload_end'] = parse(iso(rounded['berth'] + slots[serial].duration))
        out[serial] = rounded
    return out


def fill_chain(existing: dict[str, str | None], proposed: dict[str, datetime]) -> dict[str, str]:
    """Fill missing events only, clamped between the events already entered so the order stays valid."""
    known = {k: parse(v) for k, v in existing.items() if v}
    filled: dict[str, str] = {}
    floor: datetime | None = None
    for index, event in enumerate(EVENTS):
        if event in known:
            floor = known[event]
            continue
        if event not in proposed:
            continue
        later = [known[e] for e in EVENTS[index + 1:] if e in known]
        value = proposed[event]
        if floor is not None and value < floor:
            value = floor
        if later and value > min(later):
            value = min(later)
        if floor is not None and later and floor > min(later):
            continue  # entered times are already out of order; leave them for a person
        filled[event] = iso(value)
        floor = parse(filled[event])
    return filled


def order_problems(row: dict) -> list[str]:
    problems = []
    for prefix in ('planned', 'actual'):
        values = [row.get(f'{prefix}_{e}') for e in EVENTS if row.get(f'{prefix}_{e}')]
        if values != sorted(values):
            problems.append(f"{row.get('voyage_number') or row.get('voyage_no')}: {prefix} 일정 순서가 어긋납니다.")
    return problems


def overlap_problems(rows: list[dict]) -> list[str]:
    """Berthing intervals on the same berth must not overlap (rows: actual_berth/actual_unload_end set)."""
    problems = []
    by_berth: dict[str, list[tuple[datetime, datetime, str]]] = {}
    for row in rows:
        if row.get('actual_berth') and row.get('actual_unload_end') and row.get('berth_id'):
            by_berth.setdefault(row['berth_id'], []).append(
                (parse(row['actual_berth']), parse(row['actual_unload_end']), row.get('voyage_number') or ''))
    for berth, intervals in by_berth.items():
        intervals.sort()
        for (_, end, a), (start, _, b) in zip(intervals, intervals[1:]):
            if start < end:
                problems.append(f'{berth}: {a}와 {b}의 하역 시간이 겹칩니다.')
    return problems
