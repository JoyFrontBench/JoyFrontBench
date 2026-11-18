from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from dotenv import dotenv_values

from front_generation.defaults import (
    DEFAULT_CONTEXT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    DEFAULT_REASONING_EFFORT,
    DEFAULT_WIRE_PATHS,
    MODEL_DEFAULTS,
    reasoning_defaults,
)

SUPPORTED_AUTH_TYPES = {"bearer", "x-api-key"}


@dataclass(frozen=True)
class RequestConfig:
    max_tokens: int
    max_tokens_field: str
    temperature: float | None
    top_p: float | None
    extra_body: dict[str, Any]


@dataclass(frozen=True)
class ReasoningEffortConfig:
    request_path: tuple[str, ...]
    levels: tuple[str, ...]
    default: str | None
    selected: str | None


@dataclass(frozen=True)
class ModelConfig:
    name: str
    aliases: tuple[str, ...]
    label: str
    model: str
    api_base: str
    api_key_env: str
    api_key: str = field(repr=False)
    auth_type: str
    request_id_header: str | None
    enabled: bool
    enabled_env: str
    retries: int
    timeout_ms: int
    wire_api: str
    wire_path: str
    context_tokens: int
    request: RequestConfig
    reasoning_effort: ReasoningEffortConfig | None
    compatibility: dict[str, bool] = field(default_factory=dict)

    @property
    def api_url(self) -> str:
        return f"{self.api_base}{self.wire_path}"

    def public_metadata(self) -> dict[str, Any]:
        reasoning_effort = self.reasoning_effort
        return {
            "alias": self.name,
            "label": self.label,
            "model": self.model,
            "apiBase": self.api_base,
            "apiKeyEnv": self.api_key_env,
            "authType": self.auth_type,
            "requestIdHeader": self.request_id_header,
            "enabled": self.enabled,
            "enabledEnv": self.enabled_env,
            "credentialsAvailable": bool(self.api_key),
            "compatibility": dict(self.compatibility),
            "retries": self.retries,
            "timeoutMs": self.timeout_ms,
            "wireApi": self.wire_api,
            "wirePath": self.wire_path,
            "contextTokens": self.context_tokens,
            "request": {
                "maxTokens": self.request.max_tokens,
                "maxTokensField": self.request.max_tokens_field,
                "temperature": self.request.temperature,
                "topP": self.request.top_p,
                "extraBody": self.request.extra_body,
            },
            "reasoningEffort": (
                {
                    "requestPath": list(reasoning_effort.request_path),
                    "levels": list(reasoning_effort.levels),
                    "default": reasoning_effort.default,
                    "selected": reasoning_effort.selected,
                }
                if reasoning_effort
                else None
            ),
        }


def build_model_config(
    name: str,
    *,
    environment: Mapping[str, str] | None = None,
    profile: Mapping[str, Any] | None = None,
    defaults: Mapping[str, Any] | None = None,
    reasoning_effort: str | None = None,
) -> ModelConfig:
    canonical = validate_model_name(name)
    defaults = {**MODEL_DEFAULTS, **(defaults or {})}
    source = dict(profile or {})
    env = dict(environment or {})
    if reasoning_effort is None:
        reasoning_effort = env.get("MODEL_REASONING_EFFORT") or (
            DEFAULT_REASONING_EFFORT if profile is None else None
        )
    wire_api = _env_value(
        env, "MODEL_WIRE_API", source.get("wireApi", defaults["wireApi"])
    )
    request_source = {
        "maxTokens": DEFAULT_MAX_OUTPUT_TOKENS,
        "maxTokensField": (
            "max_output_tokens" if wire_api == "responses" else "max_tokens"
        ),
        **defaults.get("request", {}),
        **source.get("request", {}),
    }
    if env.get("MODEL_MAX_TOKENS"):
        request_source["maxTokens"] = int(env["MODEL_MAX_TOKENS"])
    if int(request_source["maxTokens"]) < 1:
        raise ValueError("MODEL_MAX_TOKENS must be positive")
    if wire_api not in DEFAULT_WIRE_PATHS:
        raise ValueError(f"Unsupported wireApi for {canonical}: {wire_api}")
    wire_path = _load_wire_path(canonical, source.get("wirePath"), wire_api)

    max_tokens_field = request_source["maxTokensField"]
    if max_tokens_field not in {
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
    }:
        raise ValueError(
            f"Unsupported maxTokensField for {canonical}: {max_tokens_field}"
        )

    context_tokens = int(
        _env_value(
            env,
            "MODEL_CONTEXT_TOKENS",
            source.get(
                "contextTokens",
                defaults.get("contextTokens", DEFAULT_CONTEXT_TOKENS),
            ),
        )
    )
    if context_tokens < 1:
        raise ValueError("MODEL_CONTEXT_TOKENS must be positive")
    if context_tokens < int(request_source["maxTokens"]):
        raise ValueError(f"contextTokens must be at least maxTokens for {canonical}")

    enabled_env = str(source.get("enabledEnv", ""))
    api_key_env = str(source.get("apiKeyEnv", defaults["apiKeyEnv"])).strip()
    if not api_key_env:
        raise ValueError(f"Missing apiKeyEnv for {canonical}")
    auth_type = _load_auth_type(canonical, source, defaults, wire_api)
    return ModelConfig(
        name=canonical,
        aliases=tuple(source.get("aliases", ())),
        label=source.get("label", canonical),
        model=source.get("model", canonical),
        api_base=_load_api_base(env, source, defaults),
        api_key_env=api_key_env,
        api_key=_env_value(env, api_key_env, ""),
        auth_type=auth_type,
        request_id_header=_load_request_id_header(
            canonical,
            source.get("requestIdHeader"),
        ),
        enabled=_env_boolean(env, enabled_env) if enabled_env else True,
        enabled_env=enabled_env,
        retries=int(source.get("retries", defaults["retries"])),
        timeout_ms=int(source.get("timeoutMs", defaults["timeoutMs"])),
        wire_api=wire_api,
        wire_path=wire_path,
        context_tokens=context_tokens,
        request=RequestConfig(
            max_tokens=int(request_source["maxTokens"]),
            max_tokens_field=max_tokens_field,
            temperature=_optional_float(request_source.get("temperature")),
            top_p=_optional_float(request_source.get("topP")),
            extra_body=dict(request_source.get("extraBody", {})),
        ),
        reasoning_effort=_load_reasoning_effort(
            canonical,
            source.get("reasoningEffort")
            or (reasoning_defaults(wire_api) if reasoning_effort is not None else None),
            reasoning_effort,
        ),
        compatibility=_load_compatibility(source.get("compatibility", {})),
    )


def validate_model_name(name: str) -> str:
    resolved = str(name or "").strip()
    if (
        not resolved
        or resolved.startswith("/")
        or "\\" in resolved
        or any(part in {"", ".", ".."} for part in resolved.split("/"))
        or any(character.isspace() or ord(character) < 32 for character in resolved)
    ):
        raise ValueError(
            "Model ID must be nonempty and cannot contain unsafe path segments"
        )
    return resolved


def _load_api_base(
    environment: Mapping[str, str],
    source: Mapping[str, Any],
    defaults: Mapping[str, Any],
) -> str:
    value = (
        _env_value(
            environment,
            "OPENAI_BASE_URL",
            str(source.get("apiBase", defaults["apiBase"])),
        )
        .strip()
        .rstrip("/")
    )
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "OPENAI_BASE_URL must be an HTTP(S) API base URL without credentials"
        )
    return value


def _load_compatibility(value: Any) -> dict[str, bool]:
    allowed = {
        "flattenTextContent",
        "normalizeAnthropicCostEvents",
        "retryModelServiceErrors",
        "roundTripReasoningContent",
    }
    if not isinstance(value, Mapping) or any(
        key not in allowed or not isinstance(enabled, bool)
        for key, enabled in value.items()
    ):
        raise ValueError("Invalid model compatibility options")
    return dict(value)


def load_environment(repo_root: Path) -> dict[str, str]:
    env_files = [repo_root / ".env"]
    selected_file = os.environ.get("FRONT_ENV_FILE")
    if selected_file:
        env_file = Path(selected_file).expanduser()
        if not env_file.is_file():
            raise FileNotFoundError(f"Environment file not found: {env_file}")
        if env_file.resolve() != env_files[0].resolve():
            env_files.append(env_file)
    values: dict[str, str] = {}
    for env_file in env_files:
        values.update(
            (key, value)
            for key, value in dotenv_values(env_file).items()
            if value is not None
        )
    values.update(os.environ)
    return values


def scrub_api_key_environment(api_key_env: str) -> None:
    os.environ.pop(api_key_env, None)


def _load_reasoning_effort(
    model_name: str,
    source: Mapping[str, Any] | None,
    override: str | None,
) -> ReasoningEffortConfig | None:
    if source is None:
        if override is not None:
            raise ValueError(f"{model_name} does not configure reasoning effort")
        return None

    request_path = tuple(
        str(segment).strip() for segment in source.get("requestPath", ())
    )
    levels = tuple(str(level).strip().lower() for level in source.get("levels", ()))
    if not request_path or not all(request_path) or not levels:
        raise ValueError(f"Invalid reasoningEffort config for {model_name}")
    if len(levels) != len(set(levels)):
        raise ValueError(f"Duplicate reasoning effort levels for {model_name}")

    default = _optional_effort(source.get("default"))
    selected = _optional_effort(override) if override is not None else default
    for label, value in (("default", default), ("selected", selected)):
        if value is not None and value not in levels:
            available = ", ".join(levels)
            raise ValueError(
                f'Unsupported {label} reasoning effort "{value}" for '
                f"{model_name}. Available levels: {available}"
            )

    return ReasoningEffortConfig(
        request_path=request_path,
        levels=levels,
        default=default,
        selected=selected,
    )


def _load_auth_type(
    model_name: str,
    source: Mapping[str, Any],
    defaults: Mapping[str, Any],
    wire_api: str,
) -> str:
    auth_type = (
        str(source.get("authType", defaults.get("authType", "bearer"))).strip().lower()
    )
    if auth_type not in SUPPORTED_AUTH_TYPES:
        raise ValueError(f"Unsupported authType for {model_name}: {auth_type}")
    if auth_type == "x-api-key" and wire_api != "anthropic.messages":
        raise ValueError(f"{model_name} configures x-api-key for {wire_api}")
    return auth_type


def _load_request_id_header(model_name: str, value: Any) -> str | None:
    if value is None:
        return None
    header = str(value).strip()
    if (
        not header
        or not header.isascii()
        or ":" in header
        or any(character.isspace() for character in header)
    ):
        raise ValueError(f"Invalid requestIdHeader for {model_name}: {value}")
    return header


def _load_wire_path(model_name: str, value: Any, wire_api: str) -> str:
    wire_path = str(value or DEFAULT_WIRE_PATHS[wire_api]).strip()
    if not wire_path.startswith("/") or "?" in wire_path or "#" in wire_path:
        raise ValueError(f"Invalid wirePath for {model_name}: {wire_path}")
    return wire_path.rstrip("/") or "/"


def _optional_effort(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized or None


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _env_value(environment: Mapping[str, str], name: str, fallback: str) -> str:
    value = environment.get(name)
    return fallback if value is None or value == "" else value


def _env_boolean(environment: Mapping[str, str], name: str) -> bool:
    return str(environment.get(name, "")).strip().lower() == "true"
