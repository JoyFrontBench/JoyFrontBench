from __future__ import annotations

import argparse
import json
import signal
import sys
from collections.abc import Sequence
from pathlib import Path

from front_generation.cli import (
    add_model_arguments,
    model_environment_overrides,
    status_exit_code,
)
from front_generation.defaults import DEFAULT_MAX_STEPS
from front_generation.models import load_environment
from front_generation.paths import find_repo_root

from front_openhands.runner import (
    execute_run,
    mark_dry_run,
    prepare_resume_run,
    prepare_run,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="front-openhands",
        description="Run JoyFrontBench public-set tasks with OpenHands.",
    )
    parser.add_argument(
        "--repo-root",
        help="Front repository root. Defaults to auto-discovery.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="Run one task with one model.")
    run.add_argument("--task", required=True, help="Task ID or Markdown path.")
    run.add_argument(
        "--model", required=True, help="Upstream model ID; no registration required."
    )
    add_model_arguments(run)
    run.add_argument("--run-id", help="Stable caller-provided run identifier.")
    run.add_argument(
        "--runs-root",
        type=Path,
        help="Output root. Defaults to <repo>/runs/openhands.",
    )
    run.add_argument(
        "--max-iterations",
        type=int,
        default=DEFAULT_MAX_STEPS,
        help="Maximum OpenHands iterations for this run.",
    )
    run.add_argument(
        "--timeout-seconds",
        type=int,
        help="Optional wall-clock limit for SDK startup, generation, and cleanup.",
    )
    run.add_argument(
        "--dry-run",
        action="store_true",
        help="Prepare metadata and workspace without calling the model.",
    )

    resume = commands.add_parser(
        "resume",
        help="Resume a failed persisted OpenHands conversation in place.",
    )
    resume.add_argument(
        "--source-run",
        required=True,
        type=Path,
        help="Source run directory, absolute or relative to the runs root.",
    )
    resume.add_argument(
        "--runs-root",
        type=Path,
        help="Output root. Defaults to <repo>/runs/openhands.",
    )
    add_model_arguments(resume)
    resume.add_argument(
        "--max-iterations",
        type=int,
        help="Total iteration budget; defaults to the source run value.",
    )
    resume.add_argument(
        "--timeout-seconds",
        type=int,
        help="Optional wall-clock limit for SDK startup, generation, and cleanup.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        repo_root = find_repo_root(args.repo_root)
        if args.timeout_seconds is not None and args.timeout_seconds < 1:
            raise ValueError("timeout_seconds must be at least 1")

        environment = {
            **load_environment(repo_root),
            **model_environment_overrides(args),
        }
        if args.command == "run":
            prepared = prepare_run(
                repo_root,
                task_reference=args.task,
                model_name=args.model,
                runs_root=args.runs_root,
                run_id=args.run_id,
                max_iterations=args.max_iterations,
                reasoning_effort=args.reasoning_effort,
                environment=environment,
            )
            metadata = (
                mark_dry_run(prepared)
                if args.dry_run
                else execute_run(
                    prepared,
                    max_iterations=args.max_iterations,
                    timeout_seconds=args.timeout_seconds,
                )
            )
        else:
            prepared, conversation_id, remaining_iterations = prepare_resume_run(
                repo_root,
                source_run=args.source_run,
                runs_root=args.runs_root,
                max_iterations=args.max_iterations,
                reasoning_effort=args.reasoning_effort,
                environment=environment,
            )
            metadata = execute_run(
                prepared,
                max_iterations=remaining_iterations,
                conversation_id=conversation_id,
                send_prompt=False,
                timeout_seconds=args.timeout_seconds,
            )
        print(
            json.dumps(
                {
                    "status": metadata["status"],
                    "runDir": str(prepared.run_dir),
                    "metadata": str(prepared.run_dir / "metadata.json"),
                },
                ensure_ascii=False,
            )
        )
        return status_exit_code(str(metadata["status"]))
    except (FileNotFoundError, FileExistsError, ValueError) as exc:
        parser.error(str(exc))
    except KeyboardInterrupt as exc:
        print("Interrupted.", file=sys.stderr)
        return 128 + getattr(exc, "signum", signal.SIGINT)
    return 2
