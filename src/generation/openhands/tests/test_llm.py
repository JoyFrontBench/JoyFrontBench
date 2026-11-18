import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from front_generation.paths import find_repo_root
from front_openhands_test_support import load_fixture_model as load_model
from openhands.sdk.llm import Message, MessageToolCall, TextContent

from front_openhands.llm import (
    _modelservice_retry_delay,
    build_llm,
    flatten_text_message_content,
    preserve_assistant_tool_content,
    remap_max_tokens,
)

REPO_ROOT = find_repo_root()


@pytest.mark.parametrize(
    ("attempt", "expected_delay"),
    [(1, 30), (2, 60), (3, 120), (4, 120)],
)
def test_modelservice_retry_delay(
    attempt: int,
    expected_delay: int,
) -> None:
    assert _modelservice_retry_delay(attempt) == expected_delay


def test_remaps_max_completion_tokens_for_compatible_endpoint() -> None:
    remapped = remap_max_tokens(
        {"model": "openai/chat_model", "max_completion_tokens": 32768},
        "max_tokens",
    )
    assert remapped["max_tokens"] == 32768
    assert "max_completion_tokens" not in remapped


def test_keeps_requested_field_when_already_present() -> None:
    remapped = remap_max_tokens(
        {"max_tokens": 4096, "max_completion_tokens": 32768},
        "max_tokens",
    )
    assert remapped["max_tokens"] == 4096
    assert remapped["max_completion_tokens"] == 32768


def test_flattens_text_only_message_content() -> None:
    messages = [
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
                {"type": "image_url", "image_url": {"url": "data:image/png"}},
            ],
        },
    ]

    rewritten = flatten_text_message_content(messages)

    assert rewritten[0]["content"] == "hello world"
    assert rewritten[1] == messages[1]


def test_preserves_empty_assistant_content_for_tool_calls() -> None:
    messages = [
        {
            "role": "assistant",
            "reasoning_content": "I need to inspect the workspace.",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "terminal",
                        "arguments": '{"command":"pwd"}',
                    },
                }
            ],
        },
        {"role": "assistant", "content": "done"},
    ]

    rewritten = preserve_assistant_tool_content(messages)

    assert rewritten[0]["content"] == ""
    assert rewritten[1] == messages[1]


def test_remaps_to_max_output_tokens_for_responses_api() -> None:
    remapped = remap_max_tokens(
        {"max_completion_tokens": 32768},
        "max_output_tokens",
    )
    assert remapped["max_output_tokens"] == 32768
    assert "max_completion_tokens" not in remapped


def test_build_llm_uses_model_request_and_reasoning_effort() -> None:
    model = load_model(
        REPO_ROOT,
        "chat_model",
        environment={
            "OPENAI_API_KEY": "shared-secret",
            "TEST_MODEL_ENABLED": "true",
        },
        reasoning_effort="xhigh",
    )
    llm = build_llm(model)
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_tokens"
    assert llm.reasoning_effort == "xhigh"
    assert llm.num_retries == 4
    assert llm.retry_multiplier == 30
    assert llm.retry_min_wait == 30
    assert llm.retry_max_wait == 120
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": True,
    }


def test_build_llm_configures_tool_chat_model_transient_error_retries() -> None:
    model = load_model(
        REPO_ROOT,
        "tool_chat_model",
        environment={
            "OPENAI_API_KEY": "tool_chat_model-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )

    llm = build_llm(model)

    assert llm.num_retries == 4
    assert llm.retry_multiplier == 30
    assert llm.retry_min_wait == 30
    assert llm.retry_max_wait == 120
    assert llm.retry_modelservice_errors is True
    assert llm.base_url == "https://api.example.com/v1"
    assert llm.model == "openai/tool_chat_model"
    assert llm.flatten_text_content is True
    assert llm.wire_send_reasoning_content is True
    assert llm.preserve_assistant_tool_content is True
    assert llm._model_features().send_reasoning_content is True


def test_build_llm_configures_responses_model_responses_api() -> None:
    model = load_model(
        REPO_ROOT,
        "responses_model",
        environment={
            "OPENAI_API_KEY": "shared-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    llm = build_llm(model)
    assert llm.api_mode == "responses"
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_output_tokens"
    assert llm.reasoning_effort == "high"
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": False,
        "supports_responses_api": True,
    }


def test_build_llm_configures_anthropic_model_anthropic_messages() -> None:
    model = load_model(
        REPO_ROOT,
        "anthropic_model",
        environment={
            "OPENAI_API_KEY": "shared-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    llm = build_llm(model)

    assert llm.model == "anthropic/anthropic_model"
    assert llm.base_url == "https://api.example.com/anthropic"
    assert llm.api_mode == "chat"
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_tokens"
    assert llm.wire_auth_type == "x-api-key"
    assert llm.reasoning_effort == "high"
    assert llm.litellm_extra_body == {}
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": False,
    }


def test_build_llm_retries_extended_anthropic_model_provider_error(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {"attempts": 0}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["attempts"] = int(captured["attempts"]) + 1
            captured["path"] = self.path
            captured["authorization"] = self.headers.get("Authorization")
            captured["x_api_key"] = self.headers.get("x-api-key")
            captured["body"] = json.loads(self.rfile.read(length))
            if captured["attempts"] == 1:
                payload = {
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
                        "status": "FAILED_RESPONSE",
                    }
                }
                encoded = json.dumps(payload).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
                return

            payload = {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "extended_anthropic_model",
                "content": [{"type": "text", "text": "ok"}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {
                    "input_tokens": 1,
                    "output_tokens": 1,
                    "cost_usd_input": 0.1,
                    "cost_usd_output": 0.2,
                },
            }
            encoded = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args) -> None:
            return

    monkeypatch.setattr("front_openhands.llm.time.sleep", lambda _: None)
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        model = load_model(
            REPO_ROOT,
            "extended_anthropic_model",
            environment={
                "OPENAI_API_KEY": "shared-secret",
                "TEST_MODEL_ENABLED": "true",
            },
        )
        model = replace(
            model,
            api_base=(
                f"http://127.0.0.1:{upstream.server_address[1]}/anthropic"
            ),
        )
        llm = build_llm(model)
        llm.completion(
            [Message(role="user", content=[TextContent(text="hello")])]
        )
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert llm.model == "anthropic/extended_anthropic_model"
    assert llm.wire_auth_type == "bearer"
    assert llm.retry_modelservice_errors is True
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 128000
    assert llm.reasoning_effort == "high"
    assert captured["attempts"] == 2
    assert captured["path"] == "/anthropic/v1/messages"
    assert captured["authorization"] == "Bearer shared-secret"
    assert captured["x_api_key"] is None
    body = captured["body"]
    assert body["max_tokens"] == 128000
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "high"}


def test_build_llm_injects_string_content_model_bearer_auth_and_request_id() -> None:
    captured: dict[str, object] = {}

    class UpstreamHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            captured["path"] = self.path
            captured["api_key"] = self.headers.get("api-key")
            captured["authorization"] = self.headers.get("Authorization")
            captured["request_id"] = self.headers.get("X-Request-ID")
            captured["body"] = json.loads(self.rfile.read(length))
            payload = {
                "id": "chatcmpl_string_content_model",
                "object": "chat.completion",
                "created": 1,
                "model": "string_content_model",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "ok",
                            "reasoning_content": "",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            }
            encoded = json.dumps(payload).encode()
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
        llm = build_llm(model)
        llm.completion(
            [Message(role="user", content=[TextContent(text="hello")])]
        )
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)

    assert llm.model == "openai/string_content_model"
    assert llm.wire_auth_type == "bearer"
    assert llm.request_id_header == "X-Request-ID"
    assert llm.max_input_tokens == 200000
    assert llm.max_output_tokens == 131072
    assert llm.reasoning_effort is None
    assert captured["path"] == "/api/v2/chat/completions"
    assert captured["api_key"] is None
    assert captured["authorization"] == "Bearer compatible-secret"
    request_id = captured["request_id"]
    assert isinstance(request_id, str)
    assert request_id.startswith("front-")
    body = captured["body"]
    assert body["model"] == "string_content_model"
    assert body["max_tokens"] == 131072
    assert body["temperature"] == 0
    assert body["doSample"] is False
    assert body["timeout"] == 300000
    assert body["separate_reasoning"] is True
    assert body["chat_template_kwargs"] == {"enable_thinking": True}
    assert body["messages"] == [{"content": "hello", "role": "user"}]


@pytest.mark.parametrize(
    ("name", "enabled_env", "expected_extra_body"),
    [
        (
            "tool_chat_model",
            "TEST_MODEL_ENABLED",
            {"separate_reasoning": True},
        ),
        (
            "reasoning_chat_model",
            "TEST_MODEL_ENABLED",
            {"enable_thinking": True, "separate_reasoning": True},
        ),
    ],
)
def test_build_llm_configures_high_effort_chat_models(
    name: str,
    enabled_env: str,
    expected_extra_body: dict[str, object],
) -> None:
    model = load_model(
        REPO_ROOT,
        name,
        environment={
            "OPENAI_API_KEY": "tool_chat_model-secret",
            enabled_env: "true",
        },
    )
    llm = build_llm(model)

    assert llm.api_mode == "chat"
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_tokens"
    assert llm.reasoning_effort == "high"
    assert llm.litellm_extra_body == expected_extra_body
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": False,
    }


def test_build_llm_configures_alternate_chat_model() -> None:
    model = load_model(
        REPO_ROOT,
        "alternate_chat_model",
        environment={
            "OPENAI_API_KEY": "dashscope-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    llm = build_llm(model)

    assert llm.model == "openai/reasoning_chat_model"
    assert llm.base_url == "https://api.example.com/v1"
    assert llm.api_key.get_secret_value() == "dashscope-secret"
    assert llm.api_mode == "chat"
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_tokens"
    assert llm.reasoning_effort == "high"
    assert llm.litellm_extra_body == {
        "enable_thinking": True,
        "separate_reasoning": True,
    }
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": False,
    }


def test_build_llm_configures_official_reasoning_roundtrip_model() -> None:
    model = load_model(
        REPO_ROOT,
        "reasoning_roundtrip_model",
        environment={
            "OPENAI_API_KEY": "reasoning_roundtrip_model-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )

    llm = build_llm(model)

    assert llm.model == "openai/reasoning_roundtrip_model"
    assert llm.base_url == "https://api.example.com/v1"
    assert llm.api_mode == "chat"
    assert llm.max_input_tokens == 1000000
    assert llm.max_output_tokens == 131072
    assert llm.wire_max_tokens_field == "max_tokens"
    assert llm.reasoning_effort == "high"
    assert llm.wire_send_reasoning_content is True
    assert llm.preserve_assistant_tool_content is True
    assert llm._model_features().send_reasoning_content is True
    assert llm.litellm_extra_body == {
        "thinking": {"type": "enabled"},
        "separate_reasoning": True,
    }
    assert llm.capability_overrides == {
        "supports_reasoning_effort": True,
        "supports_sampling_params": False,
    }

    assistant = Message(
        role="assistant",
        reasoning_content="I need to inspect the workspace.",
        tool_calls=[
            MessageToolCall(
                id="call_1",
                name="terminal",
                arguments='{"command":"pwd"}',
                origin="completion",
            )
        ],
    )
    formatted = llm.format_messages_for_llm([assistant])
    prepared = llm._prepare_transport_kwargs(
        messages=formatted,
        enable_streaming=False,
    )
    assert prepared["messages"] == [
        {
            "role": "assistant",
            "reasoning_content": "I need to inspect the workspace.",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "terminal",
                        "arguments": '{"command":"pwd"}',
                    },
                }
            ],
            "content": "",
        }
    ]
