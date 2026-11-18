import http.client
import io
import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import jsonschema
import pytest
from front_generation.paths import find_repo_root
from front_generation.tasks import resolve_task, task_key
from front_opencode_test_support import load_fixture_model as load_model

from front_opencode.runner import (
    AGENT_EXECUTION_INSTRUCTIONS,
    DEFAULT_PLAYWRIGHT_VERSION,
    RESUME_CONTINUATION_MESSAGE,
    _api_proxy,
    _build_agent_prompt,
    _forward_anthropic_sse,
    _is_retryable_modelservice_response,
    _playwright_runtime_instructions,
    _rewrite_request_body,
    _upstream_connection,
    _upstream_retry_delay,
    _validate_resume_progress,
    execute_run,
    mark_dry_run,
    prepare_resume_run,
    prepare_run,
    write_metadata,
)

REPO_ROOT = find_repo_root()


def test_prepare_run_uses_the_empty_mounted_directory(
    tmp_path: Path, monkeypatch,
) -> None:
    run_dir = tmp_path / "chat_model/001/mounted"
    run_dir.mkdir(parents=True)
    monkeypatch.setenv("FRONT_RUN_DIR", str(run_dir))

    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="mounted",
        environment={"OPENAI_API_KEY": "secret-value"},
    )

    assert prepared.run_dir == run_dir
    assert prepared.workspace.is_dir()
    assert (run_dir / "metadata.json").is_file()


def test_task_id_resolves_to_markdown() -> None:
    task = resolve_task(REPO_ROOT, "001")
    assert task.name == "joyfrontbench-001.md"
    assert task.suffix == ".md"
    assert task_key(task) == "001"


def test_dry_run_metadata_matches_schema(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="test-run",
        max_steps=25,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    metadata = mark_dry_run(prepared)
    schema = json.loads(
        (
            REPO_ROOT / "src" / "generation" / "opencode"
            / "schemas" / "run-metadata.schema.json"
        ).read_text(encoding="utf-8")
    )

    jsonschema.validate(metadata, schema)
    assert metadata["status"] == "dry-run"
    assert metadata["schemaVersion"] == 2
    assert metadata["run"]["maxSteps"] == 25
    assert metadata["model"]["contextTokens"] == prepared.model.context_tokens
    assert (
        metadata["model"]["request"]["maxTokens"] == prepared.model.request.max_tokens
    )
    assert metadata["model"]["enabled"] is True
    assert metadata["runtime"]["playwrightVersion"] == DEFAULT_PLAYWRIGHT_VERSION
    assert (prepared.run_dir / "prompt.md").is_file()
    assert prepared.workspace.is_dir()
    assert prepared.conversation_dir.is_dir()
    serialized_run = (prepared.run_dir / "metadata.json").read_text(encoding="utf-8")
    serialized_config = (prepared.config_dir / "opencode.json").read_text(
        encoding="utf-8"
    )
    assert "secret-value" not in serialized_run
    assert "secret-value" not in serialized_config
    assert "{env:OPENAI_API_KEY}" in serialized_config


def test_agent_prompt_requires_native_tool_execution() -> None:
    task_prompt = "Create the requested application."
    prompt = _build_agent_prompt(task_prompt)

    assert prompt.startswith(AGENT_EXECUTION_INSTRUCTIONS)
    assert "pwd && ls -la" in prompt
    assert "<write_file>" in prompt
    assert f"exact version {DEFAULT_PLAYWRIGHT_VERSION}" in prompt
    assert "front-playwright-check ." in prompt
    assert "Do not run `playwright install`" in prompt
    assert prompt.endswith(task_prompt)


def test_playwright_version_matches_shared_build_contract() -> None:
    expected = (
        REPO_ROOT / "src" / "generation" / "playwright-version.txt"
    ).read_text(encoding="utf-8").strip()

    assert DEFAULT_PLAYWRIGHT_VERSION == expected
    assert expected in _playwright_runtime_instructions()
    assert (
        f"ARG PLAYWRIGHT_VERSION={expected}"
        in (REPO_ROOT / "src" / "generation" / "opencode" / "Dockerfile").read_text(
            encoding="utf-8"
        )
    )


def test_saved_task_excludes_execution_protocol(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path,
        run_id="saved-task-run",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    task_text = prepared.task_path.read_text(encoding="utf-8")

    assert (prepared.run_dir / "task.md").read_text(encoding="utf-8") == task_text
    assert set(prepared.metadata["task"]) == {"id", "path"}
    assert prepared.prompt != task_text
    assert prepared.prompt.endswith(task_text)


def test_execute_uses_local_proxy_and_captures_events(
    tmp_path: Path,
    monkeypatch,
) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path / "runs",
        run_id="execute-run",
        max_steps=5,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    fake_opencode = tmp_path / "fake-opencode"
    fake_opencode.write_text(
        """#!/usr/bin/env python3
import json
import os
import pathlib
import sys

if "OPENAI_API_KEY" in os.environ:
    print("API key leaked into child environment", file=sys.stderr)
    raise SystemExit(2)

config = json.loads(pathlib.Path(os.environ["OPENCODE_CONFIG"]).read_text())
options = config["provider"]["front-harness"]["options"]
if options["apiKey"] != "front-harness-proxy":
    print("unexpected proxy key", file=sys.stderr)
    raise SystemExit(3)
if not options["baseURL"].startswith("http://127.0.0.1:"):
    print("missing local proxy URL", file=sys.stderr)
    raise SystemExit(5)

prompt = sys.stdin.read()
if not prompt:
    print("missing prompt", file=sys.stderr)
    raise SystemExit(4)

pathlib.Path("package.json").write_text("{}")
print(json.dumps({
    "type": "tool_use",
    "sessionID": "ses_test",
    "part": {"type": "tool", "tool": "bash"}
}))
print(json.dumps({
    "type": "text",
    "sessionID": "ses_test",
    "part": {"type": "text", "text": "done"}
}))
""",
        encoding="utf-8",
    )
    fake_opencode.chmod(0o755)
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value")

    metadata = execute_run(
        prepared,
        timeout_seconds=10,
        opencode_binary=str(fake_opencode),
    )

    assert metadata["status"] == "completed"
    assert metadata["engine"]["sessionId"] == "ses_test"
    assert metadata["events"]["counts"] == {"text": 1, "tool_use": 1}
    assert metadata["validation"] == {
        "toolUses": 1,
        "workspaceFiles": 1,
    }
    assert metadata["run"]["exitCode"] == 0
    assert "secret-value" not in (prepared.run_dir / "metadata.json").read_text(
        encoding="utf-8"
    )


def test_execute_rejects_empty_successful_agent_run(
    tmp_path: Path,
    monkeypatch,
) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path / "runs",
        run_id="empty-run",
        max_steps=5,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    fake_opencode = tmp_path / "fake-empty-opencode"
    fake_opencode.write_text(
        """#!/usr/bin/env python3
import json
import sys

sys.stdin.read()
print(json.dumps({"type": "step_start", "sessionID": "ses_empty"}))
print(json.dumps({"type": "step_finish", "sessionID": "ses_empty"}))
""",
        encoding="utf-8",
    )
    fake_opencode.chmod(0o755)
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value")

    metadata = execute_run(
        prepared,
        timeout_seconds=10,
        opencode_binary=str(fake_opencode),
    )

    assert metadata["status"] == "failed"
    assert metadata["error"]["type"] == "IncompleteAgentRun"
    assert metadata["validation"] == {
        "toolUses": 0,
        "workspaceFiles": 0,
    }


def test_execute_rejects_output_length_exhaustion(
    tmp_path: Path,
    monkeypatch,
) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path / "runs",
        run_id="length-exhausted-run",
        max_steps=5,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    fake_opencode = tmp_path / "fake-length-exhausted-opencode"
    fake_opencode.write_text(
        """#!/usr/bin/env python3
import json
import pathlib
import sys

sys.stdin.read()
pathlib.Path("package.json").write_text("{}")
print(json.dumps({"type": "step_start", "sessionID": "ses_length"}))
print(json.dumps({"type": "tool_use", "sessionID": "ses_length"}))
print(json.dumps({
    "type": "step_finish",
    "sessionID": "ses_length",
    "part": {"reason": "length"},
}))
""",
        encoding="utf-8",
    )
    fake_opencode.chmod(0o755)
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value")

    metadata = execute_run(
        prepared,
        timeout_seconds=10,
        opencode_binary=str(fake_opencode),
    )

    assert metadata["status"] == "failed"
    assert metadata["error"]["type"] == "OutputLengthExceeded"
    assert metadata["validation"] == {
        "toolUses": 1,
        "workspaceFiles": 1,
        "finishReason": "length",
    }


@pytest.mark.parametrize("saved_task", [True, False])
def test_resume_reuses_session_with_neutral_continuation_message(
    tmp_path: Path,
    monkeypatch,
    saved_task: bool,
) -> None:
    runs_root = tmp_path / "runs"
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=runs_root,
        run_id="resume-source",
        max_steps=5,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    if not saved_task:
        (prepared.run_dir / "task.md").unlink()
    prepared.workspace.joinpath("package.json").write_text("{}")
    prepared.run_dir.joinpath("events.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "tool_use",
                        "sessionID": "ses_resume",
                        "part": {"type": "tool", "tool": "bash"},
                    }
                ),
                json.dumps(
                    {
                        "type": "step_finish",
                        "sessionID": "ses_resume",
                        "part": {
                            "type": "step-finish",
                            "messageID": "msg_used",
                        },
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    prepared.metadata["status"] = "timed-out"
    prepared.metadata["error"] = {
        "type": "TimeoutExpired",
        "message": "test timeout",
    }
    prepared.metadata["completedAt"] = "2026-08-13T00:00:00Z"
    prepared.metadata["durationSeconds"] = 10
    write_metadata(prepared)

    resumed, session_id, remaining_steps = prepare_resume_run(
        REPO_ROOT,
        source_run=Path("chat_model/001/resume-source"),
        runs_root=runs_root,
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    assert resumed.run_dir == prepared.run_dir
    assert resumed.max_steps == 4
    assert session_id == "ses_resume"
    assert remaining_steps == 4
    assert resumed.metadata["resume"]["attempts"][0]["usedSteps"] == 1
    assert resumed.metadata["resume"]["attempts"][0]["remainingSteps"] == 4

    fake_opencode = tmp_path / "fake-resume-opencode"
    fake_opencode.write_text(
        """#!/usr/bin/env python3
import json
import os
import pathlib
import sys

args = sys.argv[1:]
if args[args.index("--session") + 1] != "ses_resume":
    raise SystemExit(2)
if sys.stdin.read() != "Continue.":
    raise SystemExit(3)
config = json.loads(pathlib.Path(os.environ["OPENCODE_CONFIG"]).read_text())
if config["agent"]["build"]["steps"] != 4:
    raise SystemExit(4)
print(json.dumps({
    "type": "step_start",
    "sessionID": "ses_resume",
    "part": {"type": "step-start", "messageID": "msg_resumed"}
}))
print(json.dumps({
    "type": "tool_use",
    "sessionID": "ses_resume",
    "part": {"type": "tool", "tool": "bash"}
}))
print(json.dumps({
    "type": "step_finish",
    "sessionID": "ses_resume",
    "part": {"type": "step-finish", "messageID": "msg_resumed"}
}))
""",
        encoding="utf-8",
    )
    fake_opencode.chmod(0o755)
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value")

    metadata = execute_run(
        resumed,
        timeout_seconds=10,
        opencode_binary=str(fake_opencode),
        session_id=session_id,
        send_prompt=False,
        append_events=True,
    )

    assert metadata["status"] == "completed"
    assert RESUME_CONTINUATION_MESSAGE == "Continue."
    assert metadata["run"]["command"][2:4] == ["--session", "ses_resume"]
    assert metadata["events"]["counts"] == {
        "step_finish": 2,
        "step_start": 1,
        "tool_use": 2,
    }
    assert metadata["validation"]["resumeEventsAdded"] == 3
    assert metadata["resume"]["attempts"][0]["status"] == "completed"
    assert metadata["resume"]["attempts"][0]["durationSeconds"] >= 0


def test_resume_requires_new_events(tmp_path: Path) -> None:
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=tmp_path / "runs",
        run_id="resume-progress",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    events_path = prepared.run_dir / "events.jsonl"
    events_path.write_text(
        json.dumps({"type": "step_finish", "sessionID": "ses_test"}) + "\n",
        encoding="utf-8",
    )
    prepared.metadata["status"] = "completed"

    _validate_resume_progress(prepared, events_path, events_before=1)

    assert prepared.metadata["status"] == "failed"
    assert prepared.metadata["error"]["type"] == "IncompleteResume"
    assert prepared.metadata["validation"]["resumeEventsAdded"] == 0


def test_resume_rejects_completed_run(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    prepared = prepare_run(
        REPO_ROOT,
        task_reference="001",
        model_name="chat_model",
        runs_root=runs_root,
        run_id="completed-source",
        environment={
            "OPENAI_API_KEY": "secret-value",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    prepared.metadata["status"] = "completed"
    write_metadata(prepared)

    with pytest.raises(ValueError, match="Cannot resume"):
        prepare_resume_run(
            REPO_ROOT,
            source_run=Path("chat_model/001/completed-source"),
            runs_root=runs_root,
            environment={
                "OPENAI_API_KEY": "secret-value",
                "TEST_MODEL_ENABLED": "true",
            },
        )


def test_tool_chat_model_initial_request_requires_a_tool_then_returns_to_auto() -> None:
    model = load_model(REPO_ROOT, "tool_chat_model", environment={})
    initial = {
        "model": "tool_chat_model",
        "messages": [{"role": "user", "content": "Build the application."}],
        "tools": [{"type": "function", "function": {"name": "bash"}}],
        "tool_choice": "auto",
        "max_completion_tokens": 123,
    }

    rewritten = json.loads(
        _rewrite_request_body(
            json.dumps(initial).encode(),
            max_tokens_field="max_tokens",
            initial_tool_choice=model.initial_tool_choice,
        )
    )
    assert rewritten["max_tokens"] == 123
    assert rewritten["tool_choice"] == "required"

    follow_up = {
        **initial,
        "messages": [
            *initial["messages"],
            {
                "role": "assistant",
                "tool_calls": [{"id": "call_1", "type": "function"}],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
        ],
    }
    rewritten_follow_up = json.loads(
        _rewrite_request_body(
            json.dumps(follow_up).encode(),
            max_tokens_field="max_tokens",
            initial_tool_choice=model.initial_tool_choice,
        )
    )
    assert rewritten_follow_up["tool_choice"] == "auto"

    explicit_choice = {
        **initial,
        "tool_choice": {
            "type": "function",
            "function": {"name": "bash"},
        },
    }
    rewritten_explicit_choice = json.loads(
        _rewrite_request_body(
            json.dumps(explicit_choice).encode(),
            max_tokens_field="max_tokens",
            initial_tool_choice=model.initial_tool_choice,
        )
    )
    assert rewritten_explicit_choice["tool_choice"] == explicit_choice["tool_choice"]


def test_rewrite_request_body_flattens_text_only_messages() -> None:
    body = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "hello"},
                    {"type": "text", "text": " world"},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "look"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png"},
                    },
                ],
            },
        ]
    }

    rewritten = json.loads(
        _rewrite_request_body(
            json.dumps(body).encode(),
            max_tokens_field="max_tokens",
            flatten_text_content=True,
        )
    )

    assert rewritten["messages"][0]["content"] == "hello world"
    assert rewritten["messages"][1] == body["messages"][1]


def test_api_proxy_injects_key_and_remaps_token_field() -> None:
    captured: dict[str, object] = {}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["authorization"] = self.headers["Authorization"]
            captured["body"] = json.loads(self.rfile.read(length))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "chat_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=f"http://127.0.0.1:{upstream.server_address[1]}/v1",
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/chat/completions",
                data=json.dumps(
                    {
                        "model": "chat_model",
                        "max_completion_tokens": 123,
                    }
                ).encode(),
                headers={
                    "Authorization": "Bearer placeholder",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                assert response.status == 200
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["authorization"] == "Bearer proxy-secret"
    assert captured["body"] == {
        "model": "chat_model",
        "max_tokens": 123,
        "reasoning_effort": "high",
    }


def test_upstream_connection_uses_https_proxy(monkeypatch) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:18888")
    monkeypatch.setenv("https_proxy", "http://127.0.0.1:18888")
    monkeypatch.setenv("NO_PROXY", "")
    monkeypatch.setenv("no_proxy", "")

    connection, request_path = _upstream_connection(
        urlsplit("https://api.example.com/v1"),
        "/compatible-mode/v1/chat/completions",
        30,
    )
    try:
        assert isinstance(connection, http.client.HTTPSConnection)
        assert connection.host == "127.0.0.1"
        assert connection.port == 18888
        assert connection._tunnel_host == "api.example.com"
        assert connection._tunnel_port == 443
        assert request_path == "/compatible-mode/v1/chat/completions"
    finally:
        connection.close()


def test_string_content_proxy_injects_auth_and_request_ids() -> None:
    captured: dict[str, list[object]] = {
        "api_keys": [],
        "authorizations": [],
        "request_ids": [],
        "bodies": [],
    }

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["api_keys"].append(self.headers.get("api-key"))
            captured["authorizations"].append(
                self.headers.get("Authorization")
            )
            captured["request_ids"].append(self.headers["X-Request-ID"])
            captured["bodies"].append(json.loads(self.rfile.read(length)))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "string_content_model",
            environment={
                "OPENAI_API_KEY": "compatible-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=(
                f"http://127.0.0.1:{upstream.server_address[1]}/api/v2"
            ),
        )
        with _api_proxy(model) as proxy_base:
            for _ in range(2):
                request = Request(
                    f"{proxy_base}/chat/completions",
                    data=json.dumps(
                        {
                            "model": "string_content_model",
                            "max_completion_tokens": 123,
                        }
                    ).encode(),
                    headers={
                        "Authorization": "Bearer placeholder",
                        "X-Request-ID": "placeholder",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urlopen(request, timeout=5) as response:
                    assert response.status == 200
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["api_keys"] == [None, None]
    assert captured["authorizations"] == [
        "Bearer compatible-secret",
        "Bearer compatible-secret",
    ]
    request_ids = captured["request_ids"]
    assert len(set(request_ids)) == 2
    assert all(
        isinstance(request_id, str) and request_id.startswith("front-")
        for request_id in request_ids
    )
    assert captured["bodies"] == [
        {"model": "string_content_model", "max_tokens": 123},
        {"model": "string_content_model", "max_tokens": 123},
    ]


def test_anthropic_proxy_uses_messages_path_and_x_api_key() -> None:
    captured: dict[str, object] = {}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["path"] = self.path
            captured["x_api_key"] = self.headers["x-api-key"]
            captured["authorization"] = self.headers.get("Authorization")
            captured["anthropic_version"] = self.headers["anthropic-version"]
            captured["body"] = json.loads(self.rfile.read(length))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "anthropic_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=(
                f"http://127.0.0.1:{upstream.server_address[1]}/anthropic"
            ),
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/messages",
                data=json.dumps(
                    {
                        "model": "anthropic_model",
                        "max_tokens": 123,
                        "messages": [{"role": "user", "content": "hello"}],
                    }
                ).encode(),
                headers={
                    "x-api-key": "placeholder",
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                assert response.status == 200
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["path"] == "/anthropic/v1/messages"
    assert captured["x_api_key"] == "proxy-secret"
    assert captured["authorization"] is None
    assert captured["anthropic_version"] == "2023-06-01"
    assert captured["body"] == {
        "model": "anthropic_model",
        "max_tokens": 123,
        "messages": [{"role": "user", "content": "hello"}],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }


def test_extended_anthropic_model_proxy_uses_messages_path_and_bearer_auth() -> None:
    captured: dict[str, object] = {}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["path"] = self.path
            captured["x_api_key"] = self.headers.get("x-api-key")
            captured["authorization"] = self.headers["Authorization"]
            captured["anthropic_version"] = self.headers["anthropic-version"]
            captured["body"] = json.loads(self.rfile.read(length))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "extended_anthropic_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=(
                f"http://127.0.0.1:{upstream.server_address[1]}/anthropic"
            ),
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/messages",
                data=json.dumps(
                    {
                        "model": "extended_anthropic_model",
                        "max_tokens": 123,
                        "messages": [{"role": "user", "content": "hello"}],
                    }
                ).encode(),
                headers={
                    "x-api-key": "placeholder",
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                assert response.status == 200
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["path"] == "/anthropic/v1/messages"
    assert captured["authorization"] == "Bearer proxy-secret"
    assert captured["x_api_key"] is None
    assert captured["anthropic_version"] == "2023-06-01"
    assert captured["body"] == {
        "model": "extended_anthropic_model",
        "max_tokens": 123,
        "messages": [{"role": "user", "content": "hello"}],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }


def test_extended_anthropic_model_proxy_retries_and_filters_cost_event(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {"attempts": 0}
    failed_response = json.dumps(
        {
            "error": {
                "cause": json.dumps(
                    {
                        "error": {
                            "type": "provider_error",
                            "message": "The request is invalid.",
                        },
                        "type": "error",
                    }
                ),
                "code": 400,
                "message": "model service failed",
                "status": "FAILED_RESPONSE",
            }
        }
    ).encode()
    standard_frame = (
        b"event: message_stop\n"
        b'data: {"type":"message_stop"}\n\n'
    )
    cost_frame = (
        b"event: \n"
        b"data: {\"cost_usd_input\":0.1,\"cost_usd_output\":0.2,"
        b'"cost_usd_cached_input":0.05,"cost_usd_total":0.3}\n\n'
    )

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            captured["attempts"] = int(captured["attempts"]) + 1
            length = int(self.headers["Content-Length"])
            self.rfile.read(length)
            if captured["attempts"] == 1:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(failed_response)))
                self.end_headers()
                self.wfile.write(failed_response)
                return

            payload = standard_frame + cost_frame
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:
            return

    monkeypatch.setattr("front_opencode.runner.time.sleep", lambda _: None)
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "extended_anthropic_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=(
                f"http://127.0.0.1:{upstream.server_address[1]}/anthropic"
            ),
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/messages",
                data=json.dumps(
                    {
                        "model": "extended_anthropic_model",
                        "max_tokens": 123,
                        "messages": [{"role": "user", "content": "hello"}],
                    }
                ).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                body = response.read()
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["attempts"] == 2
    assert body == standard_frame


def test_tool_chat_model_proxy_retries_rate_limit(monkeypatch) -> None:
    captured: dict[str, object] = {"attempts": 0}
    rate_limited = json.dumps(
        {
            "error": {
                "cause": json.dumps(
                    {"detail": "Rate limit reached for requests"}
                ),
                "code": 429,
                "message": "model service failed",
                "status": "FAILED_RESPONSE",
            }
        }
    ).encode()
    success = json.dumps(
        {
            "id": "chatcmpl-test",
            "model": "tool_chat_model",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "ok",
                    },
                    "finish_reason": "stop",
                }
            ],
        }
    ).encode()

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            captured["attempts"] = int(captured["attempts"]) + 1
            length = int(self.headers["Content-Length"])
            self.rfile.read(length)
            payload = rate_limited if captured["attempts"] == 1 else success
            self.send_response(429 if captured["attempts"] == 1 else 200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:
            return

    monkeypatch.setattr("front_opencode.runner.time.sleep", lambda _: None)
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "tool_chat_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=f"http://127.0.0.1:{upstream.server_address[1]}/v1",
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/chat/completions",
                data=json.dumps(
                    {
                        "model": "tool_chat_model",
                        "messages": [
                            {"role": "user", "content": "hello"}
                        ],
                    }
                ).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                body = json.loads(response.read())
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert captured["attempts"] == 2
    assert body["choices"][0]["message"]["content"] == "ok"


def test_anthropic_sse_keeps_non_cost_frames() -> None:
    standard_frame = (
        b"event: message_stop\r\n"
        b'data: {"type":"message_stop"}\r\n\r\n'
    )
    cost_frame = (
        b"event: \r\n"
        b'data: {"cost_usd_cached_input":0.1,"cost_usd_total":0.3}\r\n\r\n'
    )
    output = io.BytesIO()

    _forward_anthropic_sse(
        io.BytesIO(standard_frame + cost_frame),
        output,
    )

    assert output.getvalue() == standard_frame


@pytest.mark.parametrize("status", [408, 425, 429, 500, 502, 503, 504])
def test_modelservice_retryable_statuses(status: int) -> None:
    assert _is_retryable_modelservice_response(status, b"")


@pytest.mark.parametrize(
    ("attempt", "expected_delay"),
    [(1, 30), (2, 60), (3, 120), (4, 120)],
)
def test_upstream_retry_delay(attempt: int, expected_delay: int) -> None:
    assert _upstream_retry_delay(attempt) == expected_delay


def test_modelservice_does_not_retry_regular_bad_request() -> None:
    assert not _is_retryable_modelservice_response(
        400,
        b'{"error":{"type":"invalid_request_error"}}',
    )


def test_api_proxy_supplies_missing_streaming_tool_call_ids() -> None:
    captured: dict[str, object] = {}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["authorization"] = self.headers["Authorization"]
            captured["accept_encoding"] = self.headers["Accept-Encoding"]
            captured["body"] = json.loads(self.rfile.read(length))
            chunks = [
                {
                    "id": "chatcmpl-test",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {
                                            "name": "write",
                                            "arguments": "{",
                                        },
                                    }
                                ]
                            },
                        }
                    ],
                },
                {
                    "id": "chatcmpl-test",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {"arguments": "}"},
                                    }
                                ]
                            },
                        }
                    ],
                },
            ]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for chunk in chunks:
                payload = json.dumps(chunk, separators=(",", ":")).encode()
                self.wfile.write(b"data: " + payload + b"\n\n")
            self.wfile.write(b"data: [DONE]\n\n")

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "chat_model",
            environment={
                "OPENAI_API_KEY": "proxy-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=f"http://127.0.0.1:{upstream.server_address[1]}/v1",
        )
        with _api_proxy(model) as proxy_base:
            request = Request(
                f"{proxy_base}/chat/completions",
                data=json.dumps(
                    {
                        "model": "chat_model",
                        "stream": True,
                    }
                ).encode(),
                headers={
                    "Authorization": "Bearer placeholder",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                lines = response.read().decode().splitlines()
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    events = [
        json.loads(line.removeprefix("data: "))
        for line in lines
        if line.startswith("data: {")
    ]
    first_call = events[0]["choices"][0]["delta"]["tool_calls"][0]
    second_call = events[1]["choices"][0]["delta"]["tool_calls"][0]
    assert first_call["id"].startswith("call_front_")
    assert second_call["id"] == first_call["id"]
    assert captured["authorization"] == "Bearer proxy-secret"
    assert captured["accept_encoding"] == "identity"
