from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from front_generation.defaults import reasoning_defaults
from front_generation.models import ModelConfig as BaseModelConfig
from front_generation.models import build_model_config as build_shared_model_config
from front_generation.models import load_environment


@dataclass(frozen=True)
class ModelConfig(BaseModelConfig):
    initial_tool_choice: str | None = None

    @property
    def provider_npm(self) -> str:
        if self.wire_api == "anthropic.messages":
            return "@ai-sdk/anthropic"
        if self.wire_api == "responses":
            return "@ai-sdk/openai"
        return "@ai-sdk/openai-compatible"

    @property
    def provider_api_base(self) -> str:
        if self.wire_api == "anthropic.messages":
            prefix, _, _ = self.wire_path.rpartition("/")
            return f"{self.api_base}{prefix}"
        return self.api_base

    @property
    def opencode_model(self) -> str:
        return f"front-harness/{self.model}"

    def public_metadata(self) -> dict[str, Any]:
        return {
            **super().public_metadata(),
            "opencodeModel": self.opencode_model,
            "providerNpm": self.provider_npm,
            "providerApiBase": self.provider_api_base,
            "initialToolChoice": self.initial_tool_choice,
        }


def load_model(
    repo_root: Path,
    name: str,
    *,
    environment: Mapping[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> ModelConfig:
    env = dict(environment) if environment is not None else load_environment(repo_root)
    return build_model_config(name, environment=env, reasoning_effort=reasoning_effort)


def restore_model(
    repo_root: Path,
    metadata: Mapping[str, Any],
    *,
    environment: Mapping[str, str] | None = None,
    reasoning_effort: str | None = None,
) -> ModelConfig:
    env = dict(environment) if environment is not None else load_environment(repo_root)
    profile = deepcopy(dict(metadata))
    profile["opencode"] = {"initialToolChoice": profile.get("initialToolChoice")}
    enabled_env = profile.get("enabledEnv")
    if enabled_env and enabled_env not in env:
        env[enabled_env] = str(profile.get("enabled", False)).lower()
    reasoning = profile.get("reasoningEffort")
    if reasoning_effort is None:
        reasoning_effort = env.get("MODEL_REASONING_EFFORT") or None
    if reasoning_effort is None and isinstance(reasoning, dict):
        reasoning_effort = reasoning.get("selected")
    wire_api = env.get("MODEL_WIRE_API")
    if wire_api and wire_api != profile.get("wireApi"):
        profile.pop("wirePath", None)
        profile.get("request", {}).pop("maxTokensField", None)
        profile.pop("opencode", None)
        if wire_api != "anthropic.messages":
            profile["authType"] = "bearer"
        if isinstance(reasoning, dict):
            reasoning["requestPath"] = reasoning_defaults(wire_api)["requestPath"]
    return build_model_config(
        str(profile["alias"]),
        environment=env,
        profile=profile,
        reasoning_effort=reasoning_effort,
    )


def build_model_config(
    name: str,
    *,
    environment: Mapping[str, str] | None = None,
    profile: Mapping[str, Any] | None = None,
    defaults: Mapping[str, Any] | None = None,
    reasoning_effort: str | None = None,
) -> ModelConfig:
    shared = build_shared_model_config(
        name,
        environment=environment,
        profile=profile,
        defaults=defaults,
        reasoning_effort=reasoning_effort,
    )
    max_tokens_field = shared.request.max_tokens_field
    expected_field = (
        "max_output_tokens" if shared.wire_api == "responses" else "max_tokens"
    )
    if max_tokens_field != expected_field and not (
        shared.wire_api == "chat.completions"
        and max_tokens_field == "max_completion_tokens"
    ):
        raise ValueError(
            f"{shared.name} uses {shared.wire_api} but configures {max_tokens_field}"
        )
    return ModelConfig(
        **vars(shared),
        initial_tool_choice=_load_initial_tool_choice(
            shared.name,
            (profile or {}).get("opencode"),
            shared.wire_api,
        ),
    )


def _load_initial_tool_choice(
    model_name: str,
    source: Mapping[str, Any] | None,
    wire_api: str,
) -> str | None:
    if source is None:
        return None
    if not isinstance(source, Mapping):
        raise ValueError(f"Invalid opencode config for {model_name}")

    value = source.get("initialToolChoice")
    if value is None:
        return None
    choice = str(value).strip().lower()
    if choice != "required":
        raise ValueError(f"Unsupported initialToolChoice for {model_name}: {value}")
    if wire_api != "chat.completions":
        raise ValueError(f"{model_name} configures initialToolChoice for {wire_api}")
    return choice
