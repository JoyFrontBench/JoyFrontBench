from __future__ import annotations

import os
from pathlib import Path


def find_repo_root(explicit: str | Path | None = None) -> Path:
    configured = explicit or os.environ.get("FRONT_REPO_ROOT")
    if configured:
        root = Path(configured).expanduser().resolve()
        _validate_repo_root(root)
        return root

    origins = (Path.cwd().resolve(), Path(__file__).resolve())
    checked: set[Path] = set()
    for origin in origins:
        for candidate in (origin, *origin.parents):
            if candidate in checked:
                continue
            checked.add(candidate)
            if _is_repo_root(candidate):
                return candidate

    raise FileNotFoundError(
        "Could not locate the front repository root. Set FRONT_REPO_ROOT."
    )


def _is_repo_root(path: Path) -> bool:
    return (path / "data" / "tasks").is_dir()


def _validate_repo_root(path: Path) -> None:
    if not _is_repo_root(path):
        raise FileNotFoundError(f"Not a front repository root: {path}")


def create_run_directory(run_dir: Path) -> None:
    mounted_run = os.environ.get("FRONT_RUN_DIR")
    if mounted_run and Path(mounted_run).resolve() != run_dir.resolve():
        raise ValueError(f"Run directory does not match the mounted run: {run_dir}")
    try:
        run_dir.mkdir(parents=True)
    except FileExistsError:
        if not mounted_run or not run_dir.is_dir() or any(run_dir.iterdir()):
            raise FileExistsError(f"Run directory already exists: {run_dir}") from None
