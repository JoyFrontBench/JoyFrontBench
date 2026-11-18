import json
import os
from pathlib import Path

import pytest
from front_generation.models import load_environment, scrub_api_key_environment
from front_generation.paths import find_repo_root
from front_openhands_test_support import load_fixture_model

from front_openhands.models import build_model_config, load_model

REPO_ROOT = find_repo_root()


def test_defaults_need_only_an_api_key(tmp_path: Path) -> None:
    model = load_model(
        tmp_path, "example-model", environment={"OPENAI_API_KEY": "test-secret"},
    )
    assert not (tmp_path / "config").exists()
    assert model.api_base == "https://api.openai.com/v1"
    assert model.api_key_env == "OPENAI_API_KEY"
    assert model.api_key == "test-secret"
    assert model.auth_type == "bearer"
    assert model.wire_api == "chat.completions"
    assert model.retries == 3
    assert model.timeout_ms == 3_600_000
    assert model.context_tokens == 1_000_000
    assert model.request.max_tokens == 32_768
    assert model.reasoning_effort.selected == "high"
    assert model.request.temperature is None
    assert model.request.top_p is None
    assert model.compatibility == {}


def test_api_settings_load_from_dotenv_without_a_registry(
    tmp_path: Path, monkeypatch,
) -> None:
    (tmp_path / ".env").write_text(
        "OPENAI_API_KEY=file-secret\nOPENAI_BASE_URL=https://api.example.com/v1\n",
        encoding="utf-8",
    )
    for variable in (
        "OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL_WIRE_API", "MODEL_MAX_TOKENS",
        "MODEL_CONTEXT_TOKENS", "MODEL_REASONING_EFFORT",
    ):
        monkeypatch.delenv(variable, raising=False)
    model = load_model(tmp_path, "example-model")
    assert model.api_key == "file-secret"
    assert model.api_base == "https://api.example.com/v1"
    assert model.request.max_tokens == 32_768
    assert model.retries == 3
    assert not (tmp_path / "config").exists()


def test_legacy_registry_is_not_read(tmp_path: Path) -> None:
    legacy_path = tmp_path / "config" / "models.json"
    legacy_path.parent.mkdir()
    legacy_path.write_text("not valid JSON", encoding="utf-8")
    model = load_model(tmp_path, "chat_model_alias", environment={})
    assert model.name == "chat_model_alias"
    assert model.model == "chat_model_alias"
    assert model.request.max_tokens == 32_768


def test_environment_overrides_do_not_mutate_defaults(tmp_path: Path) -> None:
    configured = load_model(
        tmp_path, "example-model", environment={"MODEL_MAX_TOKENS": "4096"},
    )
    default = load_model(tmp_path, "example-model", environment={})
    assert configured.request.max_tokens == 4096
    assert default.request.max_tokens == 32_768


@pytest.mark.parametrize(
    "name", ["example-model", "vendor/Model-Name", "model:version"]
)
def test_upstream_model_ids_work_without_registration(name: str) -> None:
    model = load_model(
        REPO_ROOT,
        name,
        environment={
            "OPENAI_API_KEY": "test-secret",
            "OPENAI_BASE_URL": "https://api.example.com/v1/",
        },
    )
    assert model.name == name
    assert model.model == name
    assert model.enabled is True
    assert model.api_key_env == "OPENAI_API_KEY"
    assert model.api_key == "test-secret"
    assert model.api_base == "https://api.example.com/v1"
    assert model.api_url == "https://api.example.com/v1/chat/completions"
    assert model.request.max_tokens == 32_768
    assert model.compatibility == {}
    assert "test-secret" not in repr(model)
    assert "test-secret" not in json.dumps(model.public_metadata())


@pytest.mark.parametrize(
    "name",
    [
        "", "../escape", "/absolute", "vendor/../escape",
        "vendor//model", "bad\\name", "bad\nname",
    ],
)
def test_model_ids_cannot_escape_output_directories(name: str) -> None:
    with pytest.raises(ValueError, match="Model ID"):
        load_model(REPO_ROOT, name, environment={})


def test_programmatic_fixture_profiles_preserve_adapter_coverage() -> None:
    model = load_fixture_model(
        REPO_ROOT,
        "chat_model_alias",
        environment={
            "OPENAI_API_KEY": "profile-secret",
            "OPENAI_BASE_URL": "https://override.example.com/v1",
            "TEST_MODEL_ENABLED": "true",
        },
    )
    assert model.name == "chat_model"
    assert model.api_base == "https://override.example.com/v1"
    assert model.api_key == "profile-secret"
    assert model.enabled is True
    assert load_fixture_model(REPO_ROOT, "chat_model", environment={}).enabled is False


@pytest.mark.parametrize(
    ("wire_api", "wire_path", "token_field"),
    [
        ("chat.completions", "/chat/completions", "max_tokens"),
        ("responses", "/responses", "max_output_tokens"),
        ("anthropic.messages", "/v1/messages", "max_tokens"),
    ],
)
def test_protocol_is_configurable_without_model_name_rules(
    wire_api: str, wire_path: str, token_field: str
) -> None:
    model = load_model(
        REPO_ROOT,
        "custom-model",
        environment={"MODEL_WIRE_API": wire_api, "MODEL_MAX_TOKENS": "4096"},
    )
    assert model.wire_api == wire_api
    assert model.wire_path == wire_path
    assert model.request.max_tokens_field == token_field
    assert model.request.max_tokens == 4096
    prefix = "anthropic" if wire_api == "anthropic.messages" else "openai"
    assert model.openhands_model == f"{prefix}/custom-model"


def test_reasoning_defaults_to_high_and_is_validated() -> None:
    default = load_model(REPO_ROOT, "model", environment={})
    assert default.reasoning_effort.selected == "high"
    chat = load_model(REPO_ROOT, "model", environment={}, reasoning_effort="high")
    assert chat.reasoning_effort.request_path == ("reasoning_effort",)
    responses = load_model(
        REPO_ROOT,
        "model",
        environment={"MODEL_WIRE_API": "responses"},
        reasoning_effort="high",
    )
    assert responses.reasoning_effort.request_path == ("reasoning", "effort")
    assert responses.reasoning_effort.selected == "high"
    with pytest.raises(ValueError, match="reasoning effort"):
        load_model(REPO_ROOT, "model", environment={}, reasoning_effort="invalid")


@pytest.mark.parametrize(
    "api_base",
    [
        "ftp://example.com",
        "/relative",
        "https://user:secret@example.com",
        "https://example.com?key=secret",
    ],
)
def test_api_base_rejects_invalid_or_embedded_credentials(api_base: str) -> None:
    with pytest.raises(ValueError, match="OPENAI_BASE_URL"):
        load_model(REPO_ROOT, "model", environment={"OPENAI_BASE_URL": api_base})


@pytest.mark.parametrize("value", ["0", "-1", "999999999"])
def test_token_limits_are_checked(value: str) -> None:
    with pytest.raises(ValueError):
        load_model(REPO_ROOT, "model", environment={"MODEL_MAX_TOKENS": value})


def test_unsupported_protocol_is_rejected() -> None:
    with pytest.raises(ValueError, match="wireApi"):
        load_model(REPO_ROOT, "model", environment={"MODEL_WIRE_API": "invalid"})


def test_compatibility_flags_are_explicit() -> None:
    profile = {
        "compatibility": {"flattenTextContent": True, "retryModelServiceErrors": False},
    }
    model = build_model_config("custom", profile=profile, environment={})
    assert model.compatibility == {
        "flattenTextContent": True, "retryModelServiceErrors": False,
    }
    profile["compatibility"]["flattenTextContent"] = "true"
    with pytest.raises(ValueError, match="compatibility"):
        build_model_config("custom", profile=profile, environment={})


def test_environment_overrides_root_dotenv(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text(
        "OPENAI_API_KEY=file-secret\nOPENAI_BASE_URL=https://api.example.com/v1\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "shell-secret")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    values = load_environment(tmp_path)
    assert values["OPENAI_API_KEY"] == "shell-secret"
    assert values["OPENAI_BASE_URL"] == "https://api.example.com/v1"
    scrub_api_key_environment("OPENAI_API_KEY")
    assert "OPENAI_API_KEY" not in os.environ
