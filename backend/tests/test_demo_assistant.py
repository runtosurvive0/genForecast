"""수급 예측 어시스턴트: LLM 출력 검증과 API. 실제 LLM은 호출하지 않는다."""
import json as jsonlib
import socket
import threading
import time
import urllib.error
import urllib.request

import pytest
import uvicorn

from midterm import demo_assistant
from midterm.web import auth_api
from midterm.web.app import app

CONTEXT = {
    "horizon_days": 90,
    "berths": [1, 2, 3],
    "vessels": [{"id": "V-260519", "name": "GEN4CAST SENTINEL", "eta_hour": 170}],
}


def item(**kw):
    base = {k: None for k in demo_assistant.SCHEMA["properties"]["changes"]["items"]["required"]}
    base["explanation"] = "설명"
    return base | kw


def test_validate_keeps_known_items_and_converts_to_screen_format():
    raw = {
        "changes": [
            item(kind="outage", berth=2, from_hour=30, to_hour=36, factor=0, note="2부두 CV 정비"),
            item(kind="delay", vessel_id="V-260519", days=5),
            item(kind="load", from_day=0, to_day=13, pct=10),
            item(kind="strategy", strategy="environment", from_day=0, to_day=7),
        ],
        "unparsed": [],
        "reply": "네 가지 조건으로 다시 계산합니다.",
    }
    out = demo_assistant.validate(raw, CONTEXT)
    assert [c["kind"] for c in out["changes"]] == ["outage", "delay", "load", "strategy"]
    assert out["changes"][0] == {"kind": "outage", "berth": 2, "from": 30, "to": 36, "factor": 0.0, "note": "2부두 CV 정비"}
    assert out["changes"][1]["vesselName"] == "GEN4CAST SENTINEL"
    assert out["changes"][3] == {"kind": "strategy", "fromDay": 0, "toDay": 7, "strategy": "environment"}
    assert out["unparsed"] == [] and len(out["explanations"]) == 4


def test_validate_drops_items_outside_the_given_lists_and_ranges():
    raw = {
        "changes": [
            item(kind="delay", vessel_id="V-UNKNOWN", days=3, explanation="없는 선박"),
            item(kind="outage", berth=9, from_hour=0, to_hour=10, explanation="없는 부두"),
            item(kind="outage", berth=1, from_hour=20, to_hour=10, explanation="끝이 시작보다 앞"),
            item(kind="load", from_day=0, to_day=5, pct=500, explanation="과도한 증가"),
            item(kind="strategy", strategy="cheapest", from_day=0, explanation="없는 전략"),
        ],
        "unparsed": ["모르는 말"],
        "reply": "",
    }
    out = demo_assistant.validate(raw, CONTEXT)
    assert out["changes"] == []
    assert out["unparsed"][0] == "모르는 말" and len(out["unparsed"]) == 6


def test_interpret_requires_explicit_setting(monkeypatch):
    monkeypatch.delenv("GENFORECAST_ASSISTANT_LLM", raising=False)
    with pytest.raises(demo_assistant.AssistantUnavailable):
        demo_assistant.interpret("2부두 CV 내일 오전 정비", CONTEXT)
    out = demo_assistant.interpret("x", CONTEXT, call=lambda text, ctx: {"changes": [item(kind="load", from_day=1, to_day=3, pct=-5)], "unparsed": [], "reply": "확인"})
    assert out["source"] == "llm" and out["changes"][0]["pct"] == -5


def test_interpret_is_a_read_post_for_normal_users():
    assert "/api/demo-forecast/interpret" in auth_api.READ_POST


@pytest.fixture
def server(tmp_path, monkeypatch):
    from midterm.auth.store import AccessStore
    access = AccessStore(tmp_path / "access.sqlite3")
    admin = access.init_admin("test-admin", "Test Admin", "isolated assistant test password")
    token = access.login("test-admin", "isolated assistant test password")
    csrf = access.csrf(token)
    monkeypatch.setattr(app.state, "access_store", access)
    headers = {"Content-Type": "application/json", "Origin": "http://127.0.0.1:8093",
               "Cookie": f"gf_session={token}; gf_csrf={csrf}", "X-CSRF-Token": csrf, "X-Account-ID": admin["id"]}
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(16)
    port = sock.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=srv.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(.02)

    def post(body):
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/demo-forecast/interpret", jsonlib.dumps(body).encode(), headers=headers, method="POST")
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, jsonlib.loads(response.read())

    yield post
    srv.should_exit = True
    thread.join(timeout=5)
    sock.close()


def test_api_returns_503_when_llm_is_off_and_validated_changes_when_on(server, monkeypatch):
    body = {"text": "SENTINEL 5일 지연", "horizon_days": 90, "berths": [1, 2, 3],
            "vessels": [{"id": "V-260519", "name": "GEN4CAST SENTINEL", "eta_hour": 170}]}
    monkeypatch.delenv("GENFORECAST_ASSISTANT_LLM", raising=False)
    status, payload = server(body)
    assert status == 503
    monkeypatch.setenv("GENFORECAST_ASSISTANT_LLM", "1")
    monkeypatch.setattr(demo_assistant, "_call_openai", lambda text, ctx: {"changes": [item(kind="delay", vessel_id="V-260519", days=5)], "unparsed": [], "reply": "지연 반영"})
    status, payload = server(body)
    assert status == 200
    assert payload["changes"] == [{"kind": "delay", "vesselId": "V-260519", "vesselName": "GEN4CAST SENTINEL", "days": 5.0}]
    status, _ = server(body | {"text": "x" * 501})
    assert status == 422
