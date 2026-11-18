import http.client
import json
import sys
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import urlsplit

import pytest

from front_opencode import runner
from front_opencode.models import load_model
from front_opencode.runner import (
    UpstreamAPIError,
    UpstreamRetryExhausted,
    _api_proxy,
    _ProxyState,
    execute_run,
    prepare_run,
)


@pytest.fixture
def upstream(tmp_path: Path, monkeypatch):
    responses = [(200, b'{"ok": true}')]
    requests = []
    retry_attempts = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(self.rfile.read(int(self.headers["Content-Length"])))
            status, body = responses[min(len(requests) - 1, len(responses) - 1)]
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    def retry_delay(attempt):
        retry_attempts.append(attempt)
        return 0

    monkeypatch.setattr(runner, "_upstream_retry_delay", retry_delay)
    monkeypatch.setattr(runner, "getproxies", lambda: {})
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            tmp_path,
            "test-model",
            environment={
                "OPENAI_API_KEY": "test-key",
                "OPENAI_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
            },
        )
        yield model, responses, requests, retry_attempts
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def post(proxy_base):
    target = urlsplit(proxy_base)
    connection = http.client.HTTPConnection(target.hostname, target.port, timeout=5)
    try:
        connection.request(
            "POST",
            target.path + "/chat/completions",
            body=b'{"model": "test-model"}',
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


@pytest.mark.parametrize("status", [408, 425, 429, 500, 502, 503, 504])
def test_default_proxy_retries_transient_http_errors(upstream, status) -> None:
    model, responses, requests, retry_attempts = upstream
    responses[:] = [(status, b'{"error": "temporary"}'), (200, b'{"ok": true}')]
    state = _ProxyState()

    with _api_proxy(model, state=state) as proxy_base:
        result_status, body = post(proxy_base)

    assert result_status == 200
    assert json.loads(body) == {"ok": True}
    assert len(requests) == 2
    assert retry_attempts == [1]
    assert state.error is None


def test_exhausted_budget_blocks_engine_retries(upstream) -> None:
    model, responses, requests, retry_attempts = upstream
    responses[:] = [(503, b'{"error": "temporary"}')]
    state = _ProxyState()

    with _api_proxy(model, state=state) as proxy_base:
        assert post(proxy_base)[0] == 503
        assert post(proxy_base)[0] == 502

    assert len(requests) == 4
    assert retry_attempts == [1, 2, 3]
    assert isinstance(state.error, UpstreamRetryExhausted)
    assert "HTTP 503 after 3 retries" in str(state.error)


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_proxy_does_not_retry_non_transient_http_errors(upstream, status) -> None:
    model, responses, requests, retry_attempts = upstream
    responses[:] = [(status, b'{"error": "invalid"}')]
    state = _ProxyState()

    with _api_proxy(model, state=state) as proxy_base:
        assert post(proxy_base)[0] == status

    assert len(requests) == 1
    assert retry_attempts == []
    assert type(state.error) is UpstreamAPIError


@pytest.mark.parametrize("enabled", [False, True])
def test_service_specific_bad_request_retry_remains_opt_in(upstream, enabled) -> None:
    model, responses, requests, _ = upstream
    model = replace(model, compatibility={"retryModelServiceErrors": enabled})
    body = b'{"error": "FAILED_RESPONSE provider_error request is invalid"}'
    responses[:] = [(400, body), (200, b'{"ok": true}')]

    with _api_proxy(model) as proxy_base:
        assert post(proxy_base)[0] == (200 if enabled else 400)

    assert len(requests) == (2 if enabled else 1)


def test_zero_retry_budget_is_respected(upstream) -> None:
    model, responses, requests, retry_attempts = upstream
    responses[:] = [(503, b'{"error": "temporary"}')]

    with _api_proxy(replace(model, retries=0)) as proxy_base:
        assert post(proxy_base)[0] == 503

    assert len(requests) == 1
    assert retry_attempts == []


def test_transport_errors_share_the_retry_budget(upstream, monkeypatch) -> None:
    model, _, requests, retry_attempts = upstream
    original_connection = runner._upstream_connection
    connection_attempts = []

    def connect(*args):
        connection_attempts.append(args)
        if len(connection_attempts) < 3:
            raise ConnectionResetError("test reset")
        return original_connection(*args)

    monkeypatch.setattr(runner, "_upstream_connection", connect)
    with _api_proxy(model) as proxy_base:
        assert post(proxy_base)[0] == 200

    assert len(connection_attempts) == 3
    assert len(requests) == 1
    assert retry_attempts == [1, 2]


def test_partial_responses_are_not_replayed(upstream, monkeypatch) -> None:
    model, _, _, retry_attempts = upstream
    response = Mock(status=200, reason="OK")
    response.getheaders.return_value = [("Content-Type", "application/json")]
    response.getheader.return_value = "application/json"
    response.read1.side_effect = [b"partial", ConnectionResetError("stream closed")]
    connection = Mock()
    connection.getresponse.return_value = response
    connect = Mock(return_value=(connection, "/v1/chat/completions"))
    monkeypatch.setattr(runner, "_upstream_connection", connect)
    state = _ProxyState()

    with _api_proxy(model, state=state) as proxy_base:
        assert post(proxy_base) == (200, b"partial")
        assert post(proxy_base)[0] == 502

    assert connect.call_count == 1
    assert retry_attempts == []
    assert isinstance(state.error, UpstreamAPIError)


def test_execute_stops_when_upstream_budget_is_exhausted(
    upstream,
    tmp_path: Path,
) -> None:
    model, responses, requests, _ = upstream
    responses[:] = [(503, b'{"error": "temporary"}')]
    repo_root = tmp_path / "repo"
    tasks = repo_root / "data" / "tasks"
    tasks.mkdir(parents=True)
    (tasks / "joyfrontbench-001.md").write_text("A test task.\n", encoding="utf-8")
    prepared = prepare_run(
        repo_root,
        task_reference="001",
        model_name="test-model",
        environment={"OPENAI_API_KEY": "test-key", "OPENAI_BASE_URL": model.api_base},
    )
    executable = tmp_path / "fake-opencode"
    executable.write_text(
        f"#!{sys.executable}\n"
        + """\
import http.client
import json
import os
import pathlib
import time
from urllib.parse import urlsplit

config = json.loads(pathlib.Path(os.environ["OPENCODE_CONFIG"]).read_text())
target = urlsplit(config["provider"]["front-harness"]["options"]["baseURL"])
while True:
    connection = http.client.HTTPConnection(target.hostname, target.port)
    connection.request("POST", target.path + "/chat/completions", body=b"{}")
    connection.getresponse().read()
    connection.close()
    time.sleep(0.01)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)

    metadata = execute_run(prepared, opencode_binary=str(executable), timeout_seconds=5)

    assert metadata["status"] == "failed"
    assert metadata["error"]["type"] == "UpstreamRetryExhausted"
    assert metadata["run"]["exitCode"] is not None
    assert len(requests) == 4
