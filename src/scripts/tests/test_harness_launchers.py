import csv
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class HarnessLauncherTests(unittest.TestCase):
    def test_release_image_build_paths(self) -> None:
        for harness in ("opencode", "openhands"):
            for configured_root in (False, True):
                with self.subTest(harness=harness, configured_root=configured_root):
                    self.check_image_build(harness, configured_root)

    def check_image_build(self, harness: str, configured_root: bool) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repo_root = root / "repository"
            generation_root = repo_root / "src" / "generation"
            source_root = REPO_ROOT / "src" / "generation"
            scripts_root = generation_root / harness / "scripts"
            if configured_root:
                scripts_root = root / "installed" / harness
            scripts_root.mkdir(parents=True)
            builder = scripts_root / "build-image.sh"
            shutil.copyfile(source_root / harness / "scripts/build-image.sh", builder)
            dockerfile = generation_root / harness / "Dockerfile"
            dockerfile.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_root / harness / "Dockerfile", dockerfile)
            version_file = generation_root / "playwright-version.txt"
            shutil.copyfile(source_root / "playwright-version.txt", version_file)
            binaries = root / "bin"
            binaries.mkdir()
            docker = binaries / "docker"
            docker.write_text(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n", encoding="utf-8"
            )
            docker.chmod(0o755)
            image = f"test-{harness}:local"
            environment = {
                **os.environ,
                "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
                f"{harness.upper()}_HARNESS_IMAGE": image,
            }
            environment.pop("FRONT_REPO_ROOT", None)
            if configured_root:
                environment["FRONT_REPO_ROOT"] = str(repo_root)
            result = subprocess.run(
                ["bash", str(builder)],
                env=environment,
                cwd=binaries,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            arguments = result.stdout.splitlines()
            self.assertEqual(arguments[0], "build")
            self.assertEqual(arguments[arguments.index("--file") + 1], str(dockerfile))
            self.assertEqual(arguments[arguments.index("--tag") + 1], image)
            self.assertEqual(arguments[-1], str(repo_root))
            self.assertIn(
                f"PLAYWRIGHT_VERSION={version_file.read_text().strip()}",
                arguments,
            )

    def test_release_task_mounts(self) -> None:
        for harness in ("opencode", "openhands"):
            for use_override in (False, True):
                with self.subTest(harness=harness, override=use_override):
                    self.check_task_mount(harness, use_override)

    def check_task_mount(self, harness: str, use_override: bool) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            repo_root = Path(temporary_directory)
            runner = repo_root / "src" / "generation" / harness / "scripts" / "run.sh"
            runner.parent.mkdir(parents=True)
            shutil.copyfile(
                REPO_ROOT / "src" / "generation" / harness / "scripts" / "run.sh",
                runner,
            )
            shared_runner = repo_root / "src/generation/scripts/run-harness.sh"
            shared_runner.parent.mkdir(parents=True)
            shutil.copyfile(
                REPO_ROOT / shared_runner.relative_to(repo_root), shared_runner
            )
            tasks_root = repo_root / "data" / "tasks"
            if use_override:
                tasks_root = repo_root / "custom-tasks"
            tasks_root.mkdir(parents=True)
            (tasks_root / "joyfrontbench-001.md").write_text(
                "Build an app.", encoding="utf-8"
            )
            for private_directory in ("judge", "references"):
                private_root = repo_root / "data" / private_directory
                private_root.mkdir(parents=True)
                (private_root / "private.json").write_text("{}", encoding="utf-8")
            binaries = repo_root / "bin"
            binaries.mkdir()
            docker = binaries / "docker"
            docker.write_text(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n", encoding="utf-8"
            )
            docker.chmod(0o755)
            environment = {
                **os.environ,
                "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
                "FRONT_HARNESS_PAUSE_DIR": str(repo_root / "pauses"),
                "OPENAI_API_KEY": "test-key",
                "OPENAI_BASE_URL": "https://api.example.com/v1",
                f"{harness.upper()}_SKIP_BUILD": "true",
                f"{harness.upper()}_RUNS_ROOT": str(repo_root / "runs"),
            }
            environment.pop("FRONT_TASKS_ROOT", None)
            environment.pop("FRONT_REPO_ROOT", None)
            environment.pop("FRONT_ENV_FILE", None)
            if use_override:
                environment["FRONT_TASKS_ROOT"] = str(tasks_root)

            result = subprocess.run(
                [
                    "bash",
                    str(runner),
                    "run",
                    "--task",
                    "001",
                    "--model",
                    "test-model",
                    "--run-id",
                    "isolated-run",
                    "--dry-run",
                ],
                env=environment,
                cwd=binaries,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(
                f"type=bind,src={tasks_root},dst=/repo/data/tasks,readonly",
                result.stdout,
            )
            arguments = result.stdout.splitlines()
            mounts = [
                arguments[index + 1]
                for index, argument in enumerate(arguments)
                if argument == "--mount"
            ]
            self.assertCountEqual(
                mounts,
                [
                    f"type=bind,src={tasks_root},dst=/repo/data/tasks,readonly",
                    f"type=bind,src={repo_root / 'runs/test-model/001/isolated-run'},"
                    "dst=/runs/test-model/001/isolated-run",
                ],
            )
            self.assertFalse((repo_root / "config").exists())
            self.assertIn("run\n--task\n001\n", result.stdout)
            self.assertIn("--env\nOPENAI_API_KEY\n", result.stdout)
            self.assertIn("--env\nOPENAI_BASE_URL\n", result.stdout)
            self.assertNotIn("test-key", result.stdout)


class HarnessIsolationTests(unittest.TestCase):
    def launcher(self, harness: str):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        tasks_root = root / "data/tasks"
        tasks_root.mkdir(parents=True)
        (tasks_root / "joyfrontbench-001.md").write_text(
            "Build an app.", encoding="utf-8"
        )
        binaries = root / "bin"
        binaries.mkdir()
        docker = binaries / "docker"
        docker.write_text(
            "#!/usr/bin/env bash\n"
            'if [[ "$1" == run ]]; then\n'
            '  printf "%s\\n" "$@"\n'
            '  if [[ -n "${TEST_WRITE_FILE:-}" ]]; then\n'
            '    printf partial > "${TEST_WRITE_FILE}"\n'
            "  fi\n"
            '  exit "${TEST_DOCKER_EXIT:-0}"\n'
            "fi\n",
            encoding="utf-8",
        )
        docker.chmod(0o755)
        environment = {
            **os.environ,
            "PATH": f"{binaries}:{os.environ.get('PATH', '')}",
            "FRONT_REPO_ROOT": str(root),
            "FRONT_TASKS_ROOT": str(tasks_root),
            "FRONT_ENV_FILE": "",
            "FRONT_HARNESS_PAUSE_DIR": str(root / "pauses"),
            f"{harness.upper()}_SKIP_BUILD": "true",
            f"{harness.upper()}_RUNS_ROOT": str(root / "runs"),
        }

        def run(*arguments: str, **overrides: str):
            return subprocess.run(
                [
                    "bash",
                    str(REPO_ROOT / f"src/generation/{harness}/scripts/run.sh"),
                    *arguments,
                ],
                cwd=root,
                env={**environment, **overrides},
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )

        return root, run

    def mounts(self, result: subprocess.CompletedProcess) -> list[dict[str, str]]:
        self.assertEqual(result.returncode, 0, result.stderr)
        arguments = result.stdout.splitlines()
        return [
            dict(
                field.partition("=")[::2]
                for field in next(csv.reader([arguments[index + 1]]))
            )
            for index, argument in enumerate(arguments)
            if argument == "--mount"
        ]

    def test_help_and_unknown_commands_mount_no_runs(self) -> None:
        for harness in ("opencode", "openhands"):
            for arguments in (
                (),
                ("--help",),
                ("run", "--help"),
                ("resume", "--help"),
                ("unknown",),
            ):
                with self.subTest(harness=harness, arguments=arguments):
                    root, run = self.launcher(harness)
                    mounts = self.mounts(run(*arguments))
                    self.assertEqual(
                        [mount["dst"] for mount in mounts], ["/repo/data/tasks"]
                    )
                    self.assertFalse((root / "runs").exists())

    def test_only_current_run_is_mounted_with_stable_paths(self) -> None:
        for harness in ("opencode", "openhands"):
            for model in ("vendor/model:edition", 'vendor/model,"edition"'):
                with self.subTest(harness=harness, model=model):
                    root, run = self.launcher(harness)
                    sibling = root / "runs/other-model/001/older-run"
                    sibling.mkdir(parents=True)
                    result = run(
                        "run",
                        "--task=001",
                        f"--model={model}",
                        "--run-id=current",
                        "--dry-run",
                    )
                    mounted = self.mounts(result)[1]
                    self.assertEqual(
                        mounted,
                        {
                            "type": "bind",
                            "src": str(root / "runs" / model / "001/current"),
                            "dst": f"/runs/{model}/001/current",
                        },
                    )
                    self.assertIn(
                        f"FRONT_RUN_DIR=/runs/{model}/001/current", result.stdout
                    )
                    self.assertIn(
                        "--task\n/repo/data/tasks/joyfrontbench-001.md", result.stdout
                    )
                    self.assertTrue(sibling.is_dir())

    def test_old_and_new_task_ids_resolve_renamed_prompt(self) -> None:
        for harness in ("opencode", "openhands"):
            for reference in ("frontenjoyai-001", "joyfrontbench-001"):
                with self.subTest(harness=harness, reference=reference):
                    _, run = self.launcher(harness)
                    result = run(
                        "run", "--task", reference, "--model", "model", "--run-id", "test", "--dry-run"
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("--task\n/repo/data/tasks/joyfrontbench-001.md", result.stdout)

    def test_default_run_id_is_created_on_host(self) -> None:
        for harness in ("opencode", "openhands"):
            with self.subTest(harness=harness):
                _, run = self.launcher(harness)
                result = run("run", "--task", "001", "--model", "model", "--dry-run")
                mounted = self.mounts(result)[1]
                self.assertRegex(
                    mounted["dst"], r"^/runs/model/001/\d{8}T\d{6}Z-[0-9a-f]{8}$"
                )
                self.assertIn(f"--run-id\n{Path(mounted['dst']).name}\n", result.stdout)

    def test_resume_mounts_only_selected_run(self) -> None:
        for harness in ("opencode", "openhands"):
            for path_style in ("relative", "container", "host"):
                with self.subTest(harness=harness, path_style=path_style):
                    root, run = self.launcher(harness)
                    relative = "vendor/model/001/saved-run"
                    run_dir = root / "runs" / relative
                    run_dir.mkdir(parents=True)
                    (run_dir / "metadata.json").write_text("{}", encoding="utf-8")
                    source = {
                        "relative": relative,
                        "container": f"/runs/{relative}",
                        "host": str(run_dir),
                    }[path_style]
                    result = run("resume", f"--source-run={source}")
                    mounted = self.mounts(result)[1]
                    self.assertEqual(mounted["src"], str(run_dir))
                    self.assertEqual(mounted["dst"], f"/runs/{relative}")
                    self.assertIn(f"--source-run\n/runs/{relative}\n", result.stdout)

    def test_unsafe_output_paths_are_rejected(self) -> None:
        cases = (
            [
                ("run", "--task", "001", "--model", model, "--run-id", "current")
                for model in (
                    "../escape",
                    "vendor/../model",
                    "/absolute",
                    "model space",
                    "bad\\model",
                    "model//name",
                )
            ]
            + [
                ("run", "--task", "001", "--model", "model", "--run-id", run_id)
                for run_id in ("../escape", ".", "..", "run/name", "bad id")
            ]
            + [
                ("resume", "--source-run", source)
                for source in (
                    ".",
                    "/runs",
                    "/tmp/other-run",
                    "model/001/..",
                    "../model/001/run",
                    "model/../run",
                )
            ]
        )
        for harness in ("opencode", "openhands"):
            for arguments in cases:
                with self.subTest(harness=harness, arguments=arguments):
                    root, run = self.launcher(harness)
                    result = run(*arguments)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")
                    self.assertFalse((root / "runs").exists())

    def test_symlinked_output_ancestors_are_rejected(self) -> None:
        for harness in ("opencode", "openhands"):
            with self.subTest(harness=harness):
                root, run = self.launcher(harness)
                outside = root / "outside"
                outside.mkdir()
                (root / "runs").mkdir()
                (root / "runs/model").symlink_to(outside, target_is_directory=True)
                result = run(
                    "run", "--task", "001", "--model", "model", "--run-id", "current"
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("symlinks", result.stderr)
                self.assertEqual(list(outside.iterdir()), [])

    def test_tasks_outside_the_mount_are_rejected(self) -> None:
        for harness in ("opencode", "openhands"):
            for symlink in (False, True):
                with self.subTest(harness=harness, symlink=symlink):
                    root, run = self.launcher(harness)
                    outside = root / "outside.md"
                    outside.write_text("Not a task.", encoding="utf-8")
                    task = outside
                    if symlink:
                        task = root / "data/tasks/linked.md"
                        task.symlink_to(outside)
                    result = run(
                        "run",
                        "--task",
                        str(task),
                        "--model",
                        "model",
                        "--run-id",
                        "current",
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("task must be inside", result.stderr)
                    self.assertFalse((root / "runs").exists())

    def test_existing_run_is_never_overwritten(self) -> None:
        for harness in ("opencode", "openhands"):
            with self.subTest(harness=harness):
                root, run = self.launcher(harness)
                run_dir = root / "runs/model/001/current"
                run_dir.mkdir(parents=True)
                result = run(
                    "run", "--task", "001", "--model", "model", "--run-id", "current"
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("already exists", result.stderr)
                self.assertTrue(run_dir.is_dir())

    def test_failed_container_cleans_only_empty_new_run(self) -> None:
        for harness in ("opencode", "openhands"):
            for writes_output in (False, True):
                with self.subTest(harness=harness, writes_output=writes_output):
                    root, run = self.launcher(harness)
                    run_dir = root / "runs/model/001/current"
                    output = run_dir / "metadata.json"
                    result = run(
                        "run",
                        "--task",
                        "001",
                        "--model",
                        "model",
                        "--run-id",
                        "current",
                        TEST_DOCKER_EXIT="9",
                        TEST_WRITE_FILE=str(output) if writes_output else "",
                    )
                    self.assertEqual(result.returncode, 9, result.stderr)
                    self.assertEqual(run_dir.exists(), writes_output)
                    if writes_output:
                        self.assertEqual(output.read_text(encoding="utf-8"), "partial")


if __name__ == "__main__":
    unittest.main()
