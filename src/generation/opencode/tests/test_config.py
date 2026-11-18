import pytest
from front_generation.paths import find_repo_root
from front_opencode_test_support import load_fixture_model as load_model

from front_opencode.config import PROVIDER_ID, build_opencode_config

REPO_ROOT = find_repo_root()


def test_chat_config_maps_request_options_and_permissions() -> None:
    model = load_model(
        REPO_ROOT,
        "chat_model",
        environment={
            "OPENAI_API_KEY": "secret",
            "TEST_MODEL_ENABLED": "true",
        },
        reasoning_effort="high",
    )
    config = build_opencode_config(model, max_steps=25)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["chat_model"]

    assert provider["npm"] == "@ai-sdk/openai-compatible"
    assert provider["options"]["apiKey"] == "{env:OPENAI_API_KEY}"
    assert model_config["limit"] == {
        "context": 1000000,
        "output": 131072,
    }
    assert model_config["interleaved"] == {"field": "reasoning_content"}
    assert model_config["options"]["reasoningEffort"] == "high"
    assert model_config["options"]["chat_template_kwargs"] == {"enable_thinking": True}
    assert config["agent"]["build"]["temperature"] == 1
    assert config["agent"]["build"]["top_p"] == 0.95
    assert config["agent"]["build"]["steps"] == 25
    assert config["permission"]["external_directory"] == "deny"


def test_responses_config_uses_openai_sdk_and_default_effort() -> None:
    model = load_model(
        REPO_ROOT,
        "responses_model",
        environment={
            "OPENAI_API_KEY": "secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    config = build_opencode_config(
        model,
        max_steps=10,
        credential_reference="proxy-key",
        api_base="http://127.0.0.1:12345/v1",
    )
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["responses_model"]

    assert provider["npm"] == "@ai-sdk/openai"
    assert provider["options"]["apiKey"] == "proxy-key"
    assert provider["options"]["baseURL"] == "http://127.0.0.1:12345/v1"
    assert model_config["options"]["reasoningEffort"] == "high"
    assert "temperature" not in config["agent"]["build"]
    assert "top_p" not in config["agent"]["build"]


def test_string_content_model_config_uses_dedicated_key_and_thinking_mode() -> None:
    model = load_model(
        REPO_ROOT,
        "string_content_model",
        environment={
            "OPENAI_API_KEY": "secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    config = build_opencode_config(model, max_steps=10)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["string_content_model"]

    assert provider["npm"] == "@ai-sdk/openai-compatible"
    assert provider["options"]["apiKey"] == "{env:OPENAI_API_KEY}"
    assert provider["options"]["baseURL"] == (
        "https://api.example.com/v1"
    )
    assert model_config["limit"] == {
        "context": 200000,
        "output": 131072,
    }
    assert model_config["reasoning"] is True
    assert model_config["interleaved"] == {"field": "reasoning_content"}
    assert model_config["options"] == {
        "doSample": False,
        "timeout": 300000,
        "separate_reasoning": True,
        "chat_template_kwargs": {"enable_thinking": True},
    }
    assert config["agent"]["build"]["temperature"] == 0
    assert "top_p" not in config["agent"]["build"]


def test_anthropic_config_uses_adaptive_thinking_and_high_effort() -> None:
    model = load_model(
        REPO_ROOT,
        "anthropic_model",
        environment={
            "OPENAI_API_KEY": "secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    config = build_opencode_config(model, max_steps=10)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["anthropic_model"]

    assert provider["npm"] == "@ai-sdk/anthropic"
    assert provider["options"]["baseURL"] == (
        "https://api.example.com/anthropic/v1"
    )
    assert model_config["options"] == {
        "thinking": {
            "type": "adaptive",
            "display": "summarized",
        },
        "effort": "high",
    }
    assert model_config["reasoning"] is True
    assert "interleaved" not in model_config
    assert "temperature" not in config["agent"]["build"]
    assert "top_p" not in config["agent"]["build"]


def test_extended_anthropic_model_config_uses_modelservice_anthropic_base() -> None:
    model = load_model(
        REPO_ROOT,
        "extended_anthropic_model",
        environment={
            "OPENAI_API_KEY": "secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    config = build_opencode_config(model, max_steps=500)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["extended_anthropic_model"]

    assert provider["npm"] == "@ai-sdk/anthropic"
    assert provider["options"]["baseURL"] == (
        "https://api.example.com/anthropic/v1"
    )
    assert model_config["limit"] == {
        "context": 1000000,
        "output": 128000,
    }
    assert model_config["options"]["effort"] == "high"
    assert config["agent"]["build"]["steps"] == 500


@pytest.mark.parametrize(
    ("name", "enabled_env", "model_id", "expected_options"),
    [
        (
            "tool_chat_model",
            "TEST_MODEL_ENABLED",
            "tool_chat_model",
            {"separate_reasoning": True, "reasoningEffort": "high"},
        ),
        (
            "reasoning_chat_model",
            "TEST_MODEL_ENABLED",
            "reasoning_chat_model",
            {
                "enable_thinking": True,
                "separate_reasoning": True,
                "reasoningEffort": "high",
            },
        ),
    ],
)
def test_new_chat_configs_use_high_effort_and_reasoning_content(
    name: str,
    enabled_env: str,
    model_id: str,
    expected_options: dict[str, object],
) -> None:
    model = load_model(
        REPO_ROOT,
        name,
        environment={
            "OPENAI_API_KEY": "tool_chat_model-secret",
            enabled_env: "true",
        },
    )
    config = build_opencode_config(model, max_steps=10)
    model_config = config["provider"][PROVIDER_ID]["models"][model_id]

    assert model_config["limit"] == {
        "context": 1000000,
        "output": 131072,
    }
    assert model_config["interleaved"] == {"field": "reasoning_content"}
    assert model_config["options"] == expected_options
    assert "temperature" not in config["agent"]["build"]
    assert "top_p" not in config["agent"]["build"]


def test_alternate_chat_model_config_uses_dedicated_endpoint_and_key() -> None:
    model = load_model(
        REPO_ROOT,
        "alternate_chat_model",
        environment={
            "OPENAI_API_KEY": "dashscope-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    config = build_opencode_config(model, max_steps=10)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["reasoning_chat_model"]

    assert provider["npm"] == "@ai-sdk/openai-compatible"
    assert provider["options"]["apiKey"] == "{env:OPENAI_API_KEY}"
    assert provider["options"]["baseURL"] == (
        "https://api.example.com/v1"
    )
    assert model_config["limit"] == {
        "context": 1000000,
        "output": 131072,
    }
    assert model_config["interleaved"] == {"field": "reasoning_content"}
    assert model_config["options"] == {
        "enable_thinking": True,
        "separate_reasoning": True,
        "reasoningEffort": "high",
    }


def test_roundtrip_config_preserves_reasoning_content() -> None:
    model = load_model(
        REPO_ROOT,
        "reasoning_roundtrip_model",
        environment={
            "OPENAI_API_KEY": "reasoning_roundtrip_model-secret",
            "TEST_MODEL_ENABLED": "true",
        },
    )

    config = build_opencode_config(model, max_steps=10)
    provider = config["provider"][PROVIDER_ID]
    model_config = provider["models"]["reasoning_roundtrip_model"]

    assert provider["options"]["baseURL"] == "https://api.example.com/v1"
    assert provider["options"]["apiKey"] == "{env:OPENAI_API_KEY}"
    assert model_config["limit"] == {
        "context": 1000000,
        "output": 131072,
    }
    assert model_config["interleaved"] == {"field": "reasoning_content"}
    assert model_config["options"] == {
        "thinking": {"type": "enabled"},
        "separate_reasoning": True,
        "reasoningEffort": "high",
    }
