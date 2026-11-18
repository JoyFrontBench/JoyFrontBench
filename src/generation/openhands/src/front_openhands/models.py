from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from front_generation.defaults import MODEL_DEFAULTS, reasoning_defaults
from front_generation.models import ModelConfig as BaseModelConfig
from front_generation.models import build_model_config as build_shared_model_config
from front_generation.models import load_environment


@dataclass(frozen=True)
class ModelConfig(BaseModelConfig):
    litellm_provider: str = "openai"

    @property
    def openhands_model(self) -> str:
        if not self.litellm_provider:
            return self.model
        return f"{self.litellm_provider}/{self.model}"

    def public_metadata(self) -> dict[str, Any]:
        return {
            **super().public_metadata(),
            "openhandsModel": self.openhands_model,
            "litellmProvider": self.litellm_provider,
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
    if "litellmProvider" not in profile:
        model_id = str(profile["model"])
        sdk_model = str(profile.get("openhandsModel", ""))
        if sdk_model == model_id:
            profile["litellmProvider"] = ""
        elif sdk_model.endswith(f"/{model_id}"):
            profile["litellmProvider"] = sdk_model[: -(len(model_id) + 1)]
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
        if "anthropic.messages" in {wire_api, profile.get("wireApi")}:
            profile.pop("litellmProvider", None)
        if wire_api != "anthropic.messages":
            profile["authType"] = "bearer"
        if isinstance(reasoning, dict):
            reasoning["requestPath"] = reasoning_defaults(wire_api)["requestPath"]
    return build_model_config(
        str(profile["alias"]),
        environment=env,
        profile=profile,
        defaults={
            key: profile.get(key, MODEL_DEFAULTS[key])
            for key in ("retries", "timeoutMs")
        },
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
    defaults = {**MODEL_DEFAULTS, **(defaults or {})}
    source = dict(profile) if profile is not None else None
    if source is not None:
        source.pop("retries", None)
        source.pop("timeoutMs", None)
    shared = build_shared_model_config(
        name,
        environment=environment,
        profile=source,
        defaults=defaults,
        reasoning_effort=reasoning_effort,
    )
    return ModelConfig(
        **vars(shared),
        litellm_provider=(profile or {}).get(
            "litellmProvider",
            "anthropic"
            if shared.wire_api == "anthropic.messages"
            else defaults.get("litellmProvider", "openai"),
        ),
    )
