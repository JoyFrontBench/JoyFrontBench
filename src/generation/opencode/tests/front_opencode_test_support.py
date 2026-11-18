import json
from pathlib import Path

from front_generation.models import load_environment

from front_opencode.models import build_model_config

FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def load_fixture_model(repo_root, name, **options):
    fixture = json.loads((FIXTURE_ROOT / "model-profiles.json").read_text())
    aliases = {}
    for canonical, profile in fixture["models"].items():
        aliases[canonical.lower()] = canonical
        for alias in profile.get("aliases", ()):
            aliases[alias.lower()] = canonical
    canonical = aliases.get(name.lower(), name)
    if options.get("environment") is None:
        options["environment"] = load_environment(FIXTURE_ROOT)
    return build_model_config(
        canonical,
        profile=fixture["models"].get(canonical, {}),
        defaults=fixture["defaults"],
        **options,
    )
