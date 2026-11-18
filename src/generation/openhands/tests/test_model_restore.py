import json
from pathlib import Path

import pytest

from front_openhands.models import build_model_config, restore_model


def test_harness_retry_defaults_override_profile_fields() -> None:
    model = build_model_config(
        "test-model",
        defaults={"retries": 7, "timeoutMs": 123_000},
        profile={"retries": "unused", "timeoutMs": "unused"},
    )

    assert model.retries == 7
    assert model.timeout_ms == 123_000


def test_restore_preserves_all_public_settings_and_rotates_key(tmp_path: Path) -> None:
    original = build_model_config(
        "test-model",
        environment={"OPENAI_API_KEY": "old-secret"},
        defaults={"retries": 7, "timeoutMs": 123_000},
        profile={
            "apiBase": "https://original.example/v1",
            "wireApi": "responses",
            "wirePath": "/custom/responses",
            "enabledEnv": "TEST_ENABLED",
            "contextTokens": 65_536,
            "requestIdHeader": "X-Test-Request-ID",
            "request": {
                "maxTokens": 4096,
                "temperature": 0.5,
                "topP": 0.8,
                "extraBody": {"test_option": True},
            },
            "reasoningEffort": {
                "requestPath": ["reasoning", "effort"],
                "levels": ["low", "high"],
                "default": "low",
            },
            "compatibility": {"roundTripReasoningContent": True},
        },
        reasoning_effort="high",
    )
    metadata = original.public_metadata()
    before = json.dumps(metadata)

    restored = restore_model(
        tmp_path, metadata, environment={"OPENAI_API_KEY": "new-secret"},
    )

    assert restored.public_metadata() == metadata
    assert restored.api_key == "new-secret"
    assert restored.retries == 7
    assert restored.timeout_ms == 123_000
    assert json.dumps(metadata) == before
    assert "secret" not in json.dumps(restored.public_metadata())


@pytest.mark.parametrize("provider", ["openai", "custom-provider", ""])
def test_restore_recovers_provider_from_legacy_metadata(tmp_path: Path, provider):
    original = build_model_config(
        "vendor/test-model", profile={"litellmProvider": provider},
    )
    metadata = original.public_metadata()
    metadata.pop("litellmProvider")

    restored = restore_model(tmp_path, metadata, environment={})

    assert restored.litellm_provider == provider
    assert restored.openhands_model == original.openhands_model


@pytest.mark.parametrize(
    ("previous_wire", "wire_api", "token_field", "provider"),
    [
        ("responses", "chat.completions", "max_tokens", "openai"),
        ("chat.completions", "responses", "max_output_tokens", "openai"),
        ("anthropic.messages", "chat.completions", "max_tokens", "openai"),
        ("chat.completions", "anthropic.messages", "max_tokens", "anthropic"),
    ],
)
def test_explicit_protocol_override_rebuilds_protocol_fields(
    tmp_path: Path, previous_wire, wire_api, token_field, provider,
) -> None:
    original = build_model_config(
        "test-model",
        environment={"MODEL_WIRE_API": previous_wire, "MODEL_MAX_TOKENS": "4096"},
        reasoning_effort="high",
    )
    metadata = original.public_metadata()
    before = json.dumps(metadata)

    restored = restore_model(
        tmp_path, metadata,
        environment={"MODEL_WIRE_API": wire_api, "OPENAI_API_KEY": "new-secret"},
    )

    assert restored.wire_api == wire_api
    assert restored.request.max_tokens_field == token_field
    assert restored.request.max_tokens == 4096
    assert restored.litellm_provider == provider
    assert restored.reasoning_effort.selected == "high"
    expected_path = {
        "chat.completions": ("reasoning_effort",),
        "responses": ("reasoning", "effort"),
        "anthropic.messages": ("output_config", "effort"),
    }[wire_api]
    assert restored.reasoning_effort.request_path == expected_path
    assert json.dumps(metadata) == before


def test_restore_accepts_explicit_endpoint_tokens_and_reasoning(tmp_path: Path) -> None:
    original = build_model_config("test-model", reasoning_effort="high")

    restored = restore_model(
        tmp_path, original.public_metadata(),
        environment={
            "OPENAI_BASE_URL": "https://replacement.example/v1",
            "MODEL_MAX_TOKENS": "8192",
        },
        reasoning_effort="low",
    )

    assert restored.api_base == "https://replacement.example/v1"
    assert restored.request.max_tokens == 8192
    assert restored.reasoning_effort.selected == "low"


def test_restore_does_not_reuse_old_credentials(tmp_path: Path) -> None:
    original = build_model_config(
        "test-model", environment={"OPENAI_API_KEY": "old-secret"},
    )

    restored = restore_model(tmp_path, original.public_metadata(), environment={})

    assert restored.api_key == ""
    assert restored.public_metadata()["credentialsAvailable"] is False


def test_restore_rejects_invalid_overrides_without_mutating_metadata(tmp_path: Path):
    metadata = build_model_config("test-model").public_metadata()
    before = json.dumps(metadata)

    with pytest.raises(ValueError, match="MODEL_MAX_TOKENS must be positive"):
        restore_model(tmp_path, metadata, environment={"MODEL_MAX_TOKENS": "-1"})

    assert json.dumps(metadata) == before
