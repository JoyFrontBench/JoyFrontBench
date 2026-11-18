import asyncio
import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from openhands.sdk.llm import Message, TextContent

from front_openhands.llm import build_llm
from front_openhands.models import build_model_config


@pytest.mark.parametrize(
    "wire_api",
    ["chat.completions", "responses", "anthropic.messages"],
)
def test_shared_generation_defaults_reach_the_sdk(wire_api: str) -> None:
    model = build_model_config(
        "example-model",
        environment={"OPENAI_API_KEY": "test-secret", "MODEL_WIRE_API": wire_api},
    )
    llm = build_llm(model)
    assert llm.max_input_tokens == 1_000_000
    assert llm.max_output_tokens == 32_768
    assert llm.reasoning_effort == "high"
    assert llm.wire_max_tokens_field == (
        "max_output_tokens" if wire_api == "responses" else "max_tokens"
    )
    assert llm.capability_overrides["supports_reasoning_effort"] is True


@pytest.mark.parametrize(
    ("wire_api", "auth_type", "use_async"),
    [
        ("chat.completions", "bearer", False),
        ("responses", "bearer", False),
        ("anthropic.messages", "bearer", False),
        ("anthropic.messages", "bearer", True),
        ("anthropic.messages", "x-api-key", False),
        ("anthropic.messages", "x-api-key", True),
    ],
)
def test_shared_budgets_and_reasoning_reach_the_wire(
    wire_api: str,
    auth_type: str,
    use_async: bool,
) -> None:
    captured = {}
    payloads = {
        "chat.completions": {
            "id": "chat-test",
            "object": "chat.completion",
            "created": 1,
            "model": "example-model",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "ok"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
        "responses": {
            "id": "resp_test",
            "object": "response",
            "created_at": 1,
            "model": "example-model",
            "status": "completed",
            "output": [
                {
                    "id": "msg_test",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {"type": "output_text", "text": "ok", "annotations": []}
                    ],
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        },
        "anthropic.messages": {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "example-model",
            "content": [{"type": "text", "text": "ok"}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    }

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            captured["body"] = json.loads(
                self.rfile.read(int(self.headers["Content-Length"]))
            )
            captured["path"] = self.path
            captured["authorization"] = self.headers.get("Authorization")
            captured["x-api-key"] = self.headers.get("x-api-key")
            encoded = json.dumps(payloads[wire_api]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args) -> None:
            return

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = build_model_config(
            "example-model",
            environment={
                "OPENAI_API_KEY": "test-secret",
                "MODEL_WIRE_API": wire_api,
                "OPENAI_BASE_URL": f"http://127.0.0.1:{upstream.server_port}",
            },
            defaults={"retries": 0, "timeoutMs": 5000},
        )
        llm = build_llm(replace(model, auth_type=auth_type))
        messages = [Message(role="user", content=[TextContent(text="hello")])]
        if wire_api == "responses":
            llm.responses(messages)
        elif use_async:
            asyncio.run(llm.acompletion(messages))
        else:
            llm.completion(messages)
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    body = captured["body"]
    assert captured["path"] == model.wire_path
    assert body[model.request.max_tokens_field] == 32_768
    reasoning = body
    for segment in model.reasoning_effort.request_path:
        reasoning = reasoning[segment]
    assert reasoning == "high"
    if wire_api == "anthropic.messages":
        assert body["thinking"] == {"type": "adaptive"}
        assert captured["authorization"] == (
            "Bearer test-secret" if auth_type == "bearer" else None
        )
        assert captured["x-api-key"] == (
            "test-secret" if auth_type == "x-api-key" else None
        )
