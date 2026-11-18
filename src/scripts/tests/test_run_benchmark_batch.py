import csv
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "run-benchmark.sh"

HARNESS_STUB = '''\
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

arguments = sys.argv[1:]

def option(name):
    return arguments[arguments.index(name) + 1]

harness = Path(__file__).resolve().parents[1].name
runs_root = Path(os.environ[f"{harness.upper()}_RUNS_ROOT"])
if arguments[0] == "resume":
    source = Path(option("--source-run"))
    model = "/".join(source.parts[:-2])
    task = source.parts[-2]
    run_id = source.parts[-1]
else:
    model = option("--model")
    run_id = option("--run-id")
    stem = Path(option("--task")).stem
    match = re.fullmatch(r"(?:joyfrontbench|frontenjoyai)-([0-9]{3})", stem) or re.match(r"^([0-9]{3})", stem)
    task = match.group(1) if match else re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-") or "task"

child = None
if os.environ.get("STUB_CHILD"):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
payload = {
    "harness": harness, "model": model, "task": task, "arguments": arguments,
    "runs_root": str(runs_root), "tasks_root": os.environ["FRONT_TASKS_ROOT"],
    "skip_build": os.environ[f"{harness.upper()}_SKIP_BUILD"],
    "pid": os.getpid(), "child_pid": child.pid if child else None,
}

def record(event):
    with Path(os.environ["STUB_LOG"]).open("a") as handle:
        handle.write(json.dumps({**payload, "event": event, "time": time.monotonic()}) + "\\n")

record("start")
delays = json.loads(os.environ.get("STUB_DELAYS", "{}"))
time.sleep(float(delays.get(model, os.environ.get("STUB_DELAY", "0"))))
failed = model in os.environ.get("STUB_FAIL_MODELS", "").split(",")
status = "failed" if failed else "dry-run" if "--dry-run" in arguments else "completed"
run_dir = runs_root / model / task / run_id
run_dir.mkdir(parents=True, exist_ok=True)
(run_dir / "metadata.json").write_text(json.dumps({"status": status}))
for argument in arguments:
    print(f"arg:{argument}")
if child:
    child.terminate()
    child.wait()
record("end")
sys.exit(7 if failed else 0)
'''


class RunBenchmarkBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.repo_root = Path(temporary_directory.name)
        self.script_path = self.repo_root / "src" / "scripts" / SCRIPT_PATH.name
        self.script_path.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT_PATH, self.script_path)
        self.tasks_root = self.repo_root / "data" / "tasks"
        self.tasks_root.mkdir(parents=True)
        self.log_path = self.repo_root / "calls.jsonl"
        self.build_log = self.repo_root / "builds.txt"
        for number in range(1, 31):
            (self.tasks_root / f"joyfrontbench-{number:03}.md").write_text(
                "Build a page.\n", encoding="utf-8"
            )
        for harness in ("opencode", "openhands"):
            scripts_root = self.repo_root / "src" / "generation" / harness / "scripts"
            scripts_root.mkdir(parents=True)
            runner = scripts_root / "run.sh"
            runner.write_text(f"#!{sys.executable}\n{HARNESS_STUB}", encoding="utf-8")
            runner.chmod(0o755)
            builder = scripts_root / "build-image.sh"
            builder.write_text(
                "#!/usr/bin/env bash\n"
                f"printf '%s\\n' '{harness}' >> \"${{STUB_BUILD_LOG}}\"\n"
                f'[[ "${{STUB_BUILD_FAIL:-}}" != "{harness}" ]] || exit 9\n',
                encoding="utf-8",
            )
            builder.chmod(0o755)

    def generation_command(self, *options, dry_run=True, skip_build=True):
        command = ["bash", str(self.script_path), "--run-id", "test-run"]
        selected = {option.split("=", 1)[0] for option in options}
        for singular, plural, default in (
            ("--model", "--models", "example-model"),
            ("--harness", "--harnesses", "opencode"),
            ("--task", "--tasks", "all"),
        ):
            if not selected.intersection({singular, plural}):
                command.extend([plural, default])
        if dry_run:
            command.append("--dry-run")
        if skip_build:
            command.append("--skip-build")
        return [*command, *options]

    def generation_environment(self, overrides=None):
        excluded = {
            "FRONT_TASKS_ROOT", "OPENCODE_RUNS_ROOT", "OPENHANDS_RUNS_ROOT", "MODELS",
        }
        return {
            **{name: value for name, value in os.environ.items() if name not in excluded},
            "FRONT_REPO_ROOT": str(self.repo_root),
            "STUB_LOG": str(self.log_path),
            "STUB_BUILD_LOG": str(self.build_log),
            **(overrides or {}),
        }

    def run_generation(
        self, *options, dry_run=True, skip_build=True, environment=None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            self.generation_command(*options, dry_run=dry_run, skip_build=skip_build),
            env=self.generation_environment(environment),
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def events(self, event="start"):
        if not self.log_path.exists():
            return []
        events = [json.loads(line) for line in self.log_path.read_text().splitlines()]
        return [item for item in events if event is None or item["event"] == event]

    def peak_concurrency(self):
        active = 0
        peak = 0
        for event in sorted(self.events(None), key=lambda item: item["time"]):
            active += 1 if event["event"] == "start" else -1
            self.assertGreaterEqual(active, 0)
            peak = max(peak, active)
        self.assertEqual(active, 0)
        return peak

    def seed_run(self, status, *, harness="opencode", model="example-model", root=None):
        run_dir = (root or self.repo_root / "runs") / harness / model / "001" / "test-run"
        run_dir.mkdir(parents=True)
        (run_dir / "metadata.json").write_text(json.dumps({"status": status}))
        return run_dir

    def summary(self, root=None):
        summary_path = (root or self.repo_root / "runs") / "batches/test-run/summary.tsv"
        with summary_path.open() as handle:
            return list(csv.DictReader(handle, delimiter="\t"))

    def selected_numbers(
        self, result: subprocess.CompletedProcess[str]
    ) -> list[str]:
        return re.findall(r"arg:--task\narg:([0-9]{3})\n", result.stdout)

    def test_all_discovers_thirty_renamed_prompts_without_private_inputs(self) -> None:
        (self.tasks_root / "notes.md").write_text("Not a task.\n", encoding="utf-8")
        (self.tasks_root / "joyfrontbench-099.md").mkdir()

        result = self.run_generation()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.selected_numbers(result),
            [f"{number:03}" for number in range(1, 31)],
        )
        self.assertIn("Tasks: 30\n", result.stdout)
        self.assertIn("Passed: 30\n", result.stdout)
        self.assertFalse((self.repo_root / "data" / "dataset.json").exists())
        self.assertFalse((self.repo_root / "data" / "judge").exists())
        self.assertFalse((self.repo_root / "data" / "references").exists())

    def test_short_numbers_and_full_ids_select_the_same_tasks_once(self) -> None:
        result = self.run_generation(
            "--tasks", "001,joyfrontbench-001,frontenjoyai-021,030"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.selected_numbers(result), ["001", "021", "030"])
        self.assertIn("Tasks: 3\n", result.stdout)
        self.assertIn("Passed: 3\n", result.stdout)

    def test_unpublished_questions_are_rejected_before_launch(self) -> None:
        for reference in ("031", "joyfrontbench-031", "frontenjoyai-031"):
            with self.subTest(reference=reference):
                result = self.run_generation("--tasks", reference)

                self.assertEqual(result.returncode, 2)
                self.assertIn("task not found: 031", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_malformed_ids_are_rejected_before_launch(self) -> None:
        for reference in ("001x", "joyfrontbench-1", "frontenjoyai-1", "joyfrontbench-001.md"):
            with self.subTest(reference=reference):
                result = self.run_generation("--tasks", reference)

                self.assertEqual(result.returncode, 2)
                self.assertIn("invalid task ID", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_ambiguous_numbers_are_rejected_before_launch(self) -> None:
        (self.tasks_root / "001-custom.md").write_text(
            "Another page.\n", encoding="utf-8"
        )
        for reference in ("all", "001", "joyfrontbench-001", "frontenjoyai-001"):
            with self.subTest(reference=reference):
                result = self.run_generation("--tasks", reference)

                self.assertEqual(result.returncode, 2)
                self.assertIn("ambiguous task ID: 001", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_custom_number_prefixed_tasks_still_work(self) -> None:
        custom_root = self.repo_root / "custom-tasks"
        custom_root.mkdir()
        (custom_root / "042-custom.md").write_text(
            "Another page.\n", encoding="utf-8"
        )

        result = self.run_generation("--tasks-root", str(custom_root))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.selected_numbers(result), ["042"])

    def test_batch_forwards_the_same_settings_to_every_harness_and_model(self):
        result = self.run_generation(
            "--tasks=001,002", "--models=model-a,model-b",
            "--harnesses=opencode,openhands", "--context-tokens=1000000",
            "--max-output-tokens=32768", "--reasoning-effort=high",
            "--wire-api=responses", "--max-steps=19", "--timeout-seconds=30",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.events()), 8)
        for event in self.events():
            arguments = event["arguments"]
            for option, value in (
                ("--context-tokens", "1000000"), ("--max-output-tokens", "32768"),
                ("--reasoning-effort", "high"), ("--wire-api", "responses"),
                ("--timeout-seconds", "30"),
            ):
                self.assertEqual(arguments[arguments.index(option) + 1], value)
            step_option = "--max-steps" if event["harness"] == "opencode" else "--max-iterations"
            self.assertEqual(arguments[arguments.index(step_option) + 1], "19")
            self.assertEqual(event["skip_build"], "true")
            self.assertEqual(event["tasks_root"], str(self.tasks_root))
            self.assertEqual(event["runs_root"], str(self.repo_root / "runs" / event["harness"]))

    def test_parallel_models_are_deduplicated_bounded_and_keep_harness_order(self):
        result = self.run_generation(
            "--models", "model-a, model-b,model-a,model-c",
            "--harnesses", "opencode,openhands,opencode",
            "--tasks", "001,002", "--jobs", "2", skip_build=False,
            environment={"STUB_DELAY": "0.15"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.peak_concurrency(), 2)
        self.assertEqual(self.build_log.read_text().splitlines(), ["opencode", "openhands"])
        for model in ("model-a", "model-b", "model-c"):
            self.assertEqual(
                [(event["harness"], event["task"]) for event in self.events() if event["model"] == model],
                [(harness, task) for harness in ("opencode", "openhands") for task in ("001", "002")],
            )
        rows = self.summary()
        self.assertEqual(len(rows), 12)
        self.assertTrue(all(row["exit_code"] == "0" and None not in row for row in rows))
        self.assertFalse(list((self.repo_root / "runs").rglob("*.lock")))

    def test_default_execution_is_sequential_and_does_not_build_when_skipped(self):
        result = self.run_generation(
            "--models", "model-a,model-b", "--tasks", "001",
            environment={"STUB_DELAY": "0.1"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.peak_concurrency(), 1)
        self.assertEqual([event["model"] for event in self.events()], ["model-a", "model-b"])
        self.assertFalse(self.build_log.exists())

    def test_finished_worker_slot_is_reused_without_waiting_for_the_first_model(self):
        result = self.run_generation(
            "--models", "slow,fast,next", "--tasks", "001", "--jobs", "2",
            environment={"STUB_DELAYS": json.dumps({"slow": 1})},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        next_start = next(event["time"] for event in self.events() if event["model"] == "next")
        slow_end = next(event["time"] for event in self.events("end") if event["model"] == "slow")
        self.assertLess(next_start, slow_end)

    def test_large_jobs_value_is_capped_to_the_number_of_models(self):
        result = self.run_generation("--tasks", "001", "--jobs", "999999999999999999999999")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Concurrent models: 1", result.stdout)

    def test_completed_runs_are_skipped_and_summary_is_appended(self):
        first = self.run_generation("--tasks", "001,002", dry_run=False)
        second = self.run_generation("--tasks", "001,002", dry_run=False)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(len(self.events()), 2)
        self.assertIn("Skipped existing: 2", second.stdout)
        self.assertEqual(
            [row["status"] for row in self.summary()],
            ["completed", "completed", "skipped-completed", "skipped-completed"],
        )

    def test_resume_forwards_only_explicit_overrides_for_both_harnesses(self):
        for harness in ("opencode", "openhands"):
            self.seed_run("failed", harness=harness, model="provider/model")
        result = self.run_generation(
            "--models", "provider/model", "--tasks", "001",
            "--harnesses", "opencode,openhands", "--context-tokens", "262144",
            "--max-output-tokens", "8192", "--reasoning-effort", "low",
            "--wire-api", "anthropic.messages", "--max-steps", "37", dry_run=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.events()), 2)
        for event in self.events():
            arguments = event["arguments"]
            self.assertEqual(arguments[0], "resume")
            self.assertIn("provider/model/001/test-run", arguments)
            self.assertNotIn("--model", arguments)
            self.assertNotIn("--timeout-seconds", arguments)
            for option, value in (
                ("--context-tokens", "262144"), ("--max-output-tokens", "8192"),
                ("--reasoning-effort", "low"), ("--wire-api", "anthropic.messages"),
            ):
                self.assertEqual(arguments[arguments.index(option) + 1], value)
            step_option = "--max-steps" if event["harness"] == "opencode" else "--max-iterations"
            self.assertEqual(arguments[arguments.index(step_option) + 1], "37")

    def test_resume_does_not_inject_new_defaults(self):
        for harness in ("opencode", "openhands"):
            self.seed_run("interrupted", harness=harness)
        result = self.run_generation(
            "--tasks", "001", "--harnesses", "opencode,openhands", dry_run=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.events()), 2)
        for event in self.events():
            self.assertEqual(event["arguments"], ["resume", "--source-run", "example-model/001/test-run"])

    def test_dry_run_never_resumes_an_incomplete_run(self):
        for harness in ("opencode", "openhands"):
            self.seed_run("failed", harness=harness)
        result = self.run_generation("--tasks", "001", "--harnesses", "opencode,openhands")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), [])
        self.assertEqual([row["status"] for row in self.summary()], ["would-resume", "would-resume"])

    def test_dry_run_artifacts_are_skipped_in_preview_but_rejected_for_real_calls(self):
        run_dir = self.seed_run("dry-run")
        original = (run_dir / "metadata.json").read_bytes()
        preview = self.run_generation("--tasks", "001")
        actual = self.run_generation("--tasks", "001", dry_run=False)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertEqual(actual.returncode, 1)
        self.assertIn("use a new --run-id", actual.stderr)
        self.assertEqual(self.events(), [])
        self.assertEqual((run_dir / "metadata.json").read_bytes(), original)

    def test_custom_output_root_and_saved_workspace_are_preserved_on_resume(self):
        root = self.repo_root / "runs/custom-batch"
        run_dir = self.seed_run("failed", root=root)
        workspace = run_dir / "workspace"
        workspace.mkdir()
        marker = workspace / "keep.txt"
        marker.write_text("existing application")
        result = self.run_generation(
            "--tasks", "001", "--runs-root", "runs/custom-batch", dry_run=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), "existing application")
        self.assertEqual(self.events()[0]["arguments"][0], "resume")
        self.assertEqual(self.events()[0]["runs_root"], str(root / "opencode"))
        self.assertEqual(self.summary(root)[0]["status"], "completed")

    def test_output_environment_is_honored_unless_runs_root_is_explicit(self):
        override = self.repo_root / "custom-opencode"
        first = self.run_generation(
            "--tasks", "001", environment={"OPENCODE_RUNS_ROOT": str(override)},
        )
        second = self.run_generation(
            "--tasks", "001", "--runs-root", "custom-batch",
            environment={"OPENCODE_RUNS_ROOT": str(override)},
        )
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(
            [event["runs_root"] for event in self.events()],
            [str(override), str(self.repo_root / "custom-batch/opencode")],
        )

    def test_failures_continue_by_default_but_produce_a_nonzero_exit(self):
        result = self.run_generation(
            "--models", "broken,healthy", "--tasks", "001,002", dry_run=False,
            environment={"STUB_FAIL_MODELS": "broken"},
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(self.events()), 4)
        self.assertIn("Passed: 2", result.stdout)
        self.assertIn("Failed: 2", result.stdout)
        self.assertEqual([row["exit_code"] for row in self.summary()], ["7", "7", "0", "0"])

    def test_fail_fast_stops_other_workers_next_tasks_but_finishes_active_runs(self):
        result = self.run_generation(
            "--models", "broken,active,never", "--tasks", "001,002",
            "--jobs", "2", "--fail-fast", dry_run=False,
            environment={
                "STUB_FAIL_MODELS": "broken",
                "STUB_DELAYS": json.dumps({"broken": 0.15, "active": 0.5}),
            },
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual({event["model"] for event in self.events()}, {"broken", "active"})
        self.assertEqual(len(self.events()), 2)
        self.assertEqual(len(self.events("end")), 2)
        self.assertTrue(all(event["task"] == "001" for event in self.events()))
        self.assertIn("Not started: 4", result.stdout)

    def test_build_failure_stops_before_any_model_is_launched(self):
        result = self.run_generation(
            "--tasks", "001", "--harnesses", "opencode,openhands", skip_build=False,
            environment={"STUB_BUILD_FAIL": "openhands"},
        )
        self.assertEqual(result.returncode, 9)
        self.assertEqual(self.events(), [])

    def test_metadata_errors_do_not_overwrite_existing_directories(self):
        run_dir = self.seed_run("failed")
        metadata = run_dir / "metadata.json"
        for source in ("{broken json", None):
            with self.subTest(source=source):
                if source is None:
                    metadata.unlink()
                else:
                    metadata.write_text(source)
                result = self.run_generation("--tasks", "001", dry_run=False)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(self.events(), [])
                if source is not None:
                    self.assertEqual(metadata.read_text(), source)
                else:
                    self.assertFalse(metadata.exists())

    def test_invalid_selection_and_unsafe_models_fail_before_launch(self):
        cases = (
            (["--harness", "opencode", "--harnesses", "openhands"], "use either --harness"),
            (["--task", "001", "--tasks", "002"], "use either --task"),
            (["--harnesses", "opencode,unknown"], "unsupported harness"),
            (["--jobs=0"], "--jobs must be a positive integer"),
            (["--jobs="], "--jobs requires a value"),
            (["--run-id", "../escape"], "--run-id must use ASCII"),
            (["--model", "../escape"], "unsafe model ID"),
            (["--model", "/absolute"], "unsafe model ID"),
            (["--model", "provider//model"], "unsafe model ID"),
            (["--model", "provider/./model"], "unsafe model ID"),
            (["--model", "has spaces"], "invalid model ID"),
            (["--models", "model\nignored"], "lists must use one line"),
            (["--dry-run=false"], "does not take a value"),
        )
        for options, expected in cases:
            with self.subTest(options=options):
                result = self.run_generation(*options)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(expected, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertEqual(self.events(), [])

    def test_markdown_path_uses_the_mounted_task_root_and_matches_native_task_keys(self):
        directory = self.tasks_root / "nested folder"
        directory.mkdir()
        task_path = directory / "custom page.md"
        task_path.write_text("Build a custom page.\n")
        result = self.run_generation("--task", str(task_path))
        self.assertEqual(result.returncode, 0, result.stderr)
        event = self.events()[0]
        self.assertIn("/repo/data/tasks/nested folder/custom page.md", event["arguments"])
        self.assertEqual(event["tasks_root"], str(self.tasks_root))
        self.assertEqual(self.summary()[0]["task"], "custom-page")

    def test_renamed_task_path_keeps_the_numeric_workspace_id(self):
        result = self.run_generation("--task", str(self.tasks_root / "joyfrontbench-001.md"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/repo/data/tasks/joyfrontbench-001.md", self.events()[0]["arguments"])
        self.assertEqual(self.summary()[0]["task"], "001")

    def test_task_path_outside_the_mounted_root_is_rejected(self):
        task_path = self.repo_root / "private.md"
        task_path.write_text("Not in the task directory.\n")
        result = self.run_generation("--task", str(task_path))
        self.assertEqual(result.returncode, 2)
        self.assertIn("task path must be inside --tasks-root", result.stderr)
        self.assertEqual(self.events(), [])

    def test_sigterm_stops_workers_and_their_children(self):
        process = subprocess.Popen(
            self.generation_command("--models", "first,second", "--tasks", "001", "--jobs", "2"),
            env=self.generation_environment({"STUB_DELAY": "60", "STUB_CHILD": "1"}),
            cwd=self.repo_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 10
            while len(self.events()) < 2 and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertEqual(len(self.events()), 2)
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 143, stderr)
            self.assertIn("Summary:", stdout)
            for event in self.events():
                for identifier in (event["pid"], event["child_pid"]):
                    status = subprocess.run(
                        ["ps", "-o", "stat=", "-p", str(identifier)],
                        capture_output=True, text=True, check=False,
                    ).stdout.strip()
                    self.assertTrue(not status or status.startswith("Z"), status)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
