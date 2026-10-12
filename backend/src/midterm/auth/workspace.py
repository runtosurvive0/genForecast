"""Validate private workspace DTOs before persisting untrusted browser input."""
import json
from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from .store import AccessError

Text = Annotated[str, Field(min_length=1, max_length=160)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class DTO(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


def valid_date(value):
    if value is not None:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None or not 1900 <= dt.year <= 2100:
            raise ValueError('Invalid timestamp')
    return value


class Position(DTO):
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    observedAt: str
    sogKn: Annotated[float, Field(ge=0, le=102.2)] | None = None
    cogDeg: Annotated[float, Field(ge=0, le=360)] | None = None
    _date = field_validator('observedAt')(valid_date)


class AIS(DTO):
    updatedAt: str
    destination: Annotated[str, Field(max_length=100)] = ''
    shipType: Annotated[float, Field(ge=1, le=99)] | None = None
    navStatus: Annotated[float, Field(ge=0, le=14)] | None = None
    position: Position | None = None
    _date = field_validator('updatedAt')(valid_date)


class Vessel(DTO):
    id: Text
    name: Annotated[str, Field(min_length=1, max_length=100)]
    imo: Annotated[str, Field(pattern=r'^(|\d{7}|DEMO-\d+)$')] = ''
    mmsi: Annotated[str, Field(pattern=r'^(|\d{9})$')] = ''
    source: Literal['manual', 'demo', 'aisstream', 'digitraffic']
    ais: AIS | None = None
    legacyId: Text | None = None

    @model_validator(mode='after')
    def identifiers(self):
        if not self.imo and not self.mmsi:
            raise ValueError('Missing vessel identifier')
        if self.source in ('aisstream', 'digitraffic') and (not self.ais or not self.mmsi or self.imo.startswith('DEMO')):
            raise ValueError('Missing actual observation')
        if self.source in ('demo', 'manual') and self.ais is not None:
            raise ValueError('Unexpected actual observation')
        return self


class Voyage(DTO):
    id: Text
    vesselId: Text
    plantId: Literal['dangjin', 'boryeong', 'hadong', 'donghae']
    origin: Text
    destination: Text
    state: Literal['planned', 'underway', 'stopped', 'arrived', 'cancelled']
    etd: str | None
    plannedEta: str | None
    actualArrivalAt: str | None = None
    distanceNm: Annotated[float, Field(ge=0, le=30000)] | None
    plannedSpeedKn: Annotated[float, Field(ge=.1, le=50)] | None
    position: Position | None
    portWaitH: Annotated[float, Field(ge=0, le=8760)] | None
    unloadH: Annotated[float, Field(ge=0, le=8760)] | None
    cargoT: Annotated[float, Field(ge=0, le=1000000)]
    cv: Annotated[float, Field(ge=1, le=15000)]
    _dates = field_validator('etd', 'plannedEta', 'actualArrivalAt')(valid_date)


class Workspace(DTO):
    version: Literal[1]
    watchlist: Annotated[list[Text], Field(max_length=200)]
    vessels: Annotated[list[Vessel], Field(max_length=200)]
    voyages: Annotated[list[Voyage], Field(max_length=200)]


def checked_workspace(payload, destinations):
    try:
        if len(json.dumps([payload, destinations], ensure_ascii=False).encode('utf-8')) > 1000000:
            raise ValueError('Too large')
        model = Workspace.model_validate(payload)
        if len({v.id for v in model.vessels}) != len(model.vessels) or len({v.vesselId for v in model.voyages}) != len(model.voyages):
            raise ValueError('Duplicate vessel')
        if not isinstance(destinations, dict) or len(destinations) > 200:
            raise ValueError('Invalid destinations')
        if any(not isinstance(k, str) or not 1 <= len(k) <= 160 or v not in ('', 'ais', 'dangjin', 'boryeong', 'hadong', 'donghae') for k, v in destinations.items()):
            raise ValueError('Invalid destination choice')
        result = model.model_dump(exclude_unset=True)
        # Preserve the frontend's optional AIS field: null means no field, not a malformed AIS observation.
        for vessel in result['vessels']:
            if vessel.get('ais') is None:
                vessel.pop('ais', None)
            if vessel.get('legacyId') is None:
                vessel.pop('legacyId', None)
        result['watchlist'] = list(dict.fromkeys(result['watchlist']))
        return result, destinations
    except (ValidationError, ValueError, TypeError):
        raise AccessError(422, 'invalid_workspace', '관심 목록 형식·좌표·시각·목적항을 확인해 주세요. 최대 200척, 1MB입니다.') from None
