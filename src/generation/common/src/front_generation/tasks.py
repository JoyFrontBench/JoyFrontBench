from __future__ import annotations

import re
from pathlib import Path


def resolve_task(repo_root: Path, reference: str) -> Path:
    supplied = Path(reference).expanduser()
    direct_candidates = [
        supplied,
        Path.cwd() / supplied,
        repo_root / supplied,
    ]
    for candidate in direct_candidates:
        if candidate.is_file():
            return candidate.resolve()

    tasks_dir = repo_root / "data" / "tasks"
    exact = tasks_dir / reference
    if exact.is_file():
        return exact.resolve()
    if not exact.suffix:
        markdown = exact.with_suffix(".md")
        if markdown.is_file():
            return markdown.resolve()

    patterns = [f"{reference}-*.md"]
    numbered = re.fullmatch(r"(?:(?:joyfrontbench|frontenjoyai)-)?([0-9]{3})", reference)
    if numbered:
        number = numbered.group(1)
        patterns.extend((f"joyfrontbench-{number}.md", f"frontenjoyai-{number}.md"))
    matches = sorted(
        {
            path
            for pattern in patterns
            for path in tasks_dir.glob(pattern)
            if path.is_file()
        }
    )
    if len(matches) == 1:
        return matches[0].resolve()
    if len(matches) > 1:
        raise ValueError(f'Ambiguous task reference "{reference}"')
    raise FileNotFoundError(f'Task not found: "{reference}"')


def task_key(task_path: Path) -> str:
    match = re.fullmatch(r"(?:joyfrontbench|frontenjoyai)-([0-9]{3})", task_path.stem)
    if not match:
        match = re.match(r"^(\d{3})", task_path.stem)
    if match:
        return match.group(1)
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", task_path.stem).strip("-")
    return normalized or "task"
