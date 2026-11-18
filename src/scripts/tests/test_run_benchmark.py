import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "run-benchmark.sh"


class RunBenchmarkTests(unittest.TestCase):
    def run_stubbed_harness(self, harness, options):
        with tempfile.TemporaryDirectory() as temporary_directory:
            repo_root = Path(temporary_directory)
            tasks_root = repo_root / "data" / "tasks"
            tasks_root.mkdir(parents=True)
            (tasks_root / "joyfrontbench-001.md").write_text("Build a page.\n")
            scripts = repo_root / "src" / "generation" / harness / "scripts"
            scripts.mkdir(parents=True)
            runner = scripts / "run.sh"
            runner.write_text('#!/usr/bin/env bash\nprintf \'arg:%s\\n\' "$@"\n')
            runner.chmod(0o755)
            builder = scripts / "build-image.sh"
            builder.write_text("#!/usr/bin/env bash\nexit 99\n")
            builder.chmod(0o755)
            return subprocess.run(
                [
                    "bash", str(SCRIPT_PATH), "--harness", harness,
                    "--task", "001", "--skip-build", "--dry-run", *options,
                ],
                env={**os.environ, "FRONT_REPO_ROOT": str(repo_root)},
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )

    def test_single_model_leaves_omitted_settings_to_the_harness(self):
        for harness in ("opencode", "openhands"):
            with self.subTest(harness=harness):
                result = self.run_stubbed_harness(harness, ["--model", "example-model"])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("arg:--model\narg:example-model\n", result.stdout)
                for option in (
                    "--context-tokens", "--max-output-tokens", "--reasoning-effort",
                    "--wire-api", "--max-steps", "--max-iterations",
                ):
                    self.assertNotIn(f"arg:{option}\n", result.stdout)

    def test_single_model_forwards_all_explicit_generation_settings(self):
        for harness, step_option in (
            ("opencode", "--max-steps"), ("openhands", "--max-iterations"),
        ):
            for use_equals in (False, True):
                with self.subTest(harness=harness, use_equals=use_equals):
                    settings = [
                        ("--model", "example-model"), ("--context-tokens", "1000000"),
                        ("--max-output-tokens", "32768"), ("--reasoning-effort", "high"),
                        ("--wire-api", "responses"), ("--max-steps", "41"),
                    ]
                    options = (
                        [f"{option}={value}" for option, value in settings]
                        if use_equals
                        else [item for setting in settings for item in setting]
                    )
                    result = self.run_stubbed_harness(harness, options)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for option, value in settings:
                        forwarded = step_option if option == "--max-steps" else option
                        self.assertIn(f"arg:{forwarded}\narg:{value}\n", result.stdout)

    def test_invalid_generation_settings_fail_before_launch(self):
        for options, error in (
            (["--context-tokens", "0"], "--context-tokens must be a positive integer"),
            (["--max-output-tokens", "-1"], "--max-output-tokens must be a positive integer"),
            (["--wire-api", "messages"], "--wire-api must be"),
            (["--max-output-tokens="], "--max-output-tokens requires a value"),
            (["--max-steps="], "--max-steps requires a value"),
            (["--models", "another-model"], "use either --model or --models"),
        ):
            with self.subTest(options=options):
                result = self.run_stubbed_harness(
                    "opencode", ["--model", "example-model", *options],
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn(error, result.stderr)
                self.assertNotIn("arg:run", result.stdout)

    def test_help_only_lists_generation_harnesses(self):
        result = subprocess.run(
            ["bash", str(SCRIPT_PATH), "--help"],
            capture_output=True,
            text=True,
            check=True,
        )

        self.assertIn("--harness NAME          opencode or openhands", result.stdout)
        self.assertNotIn("codex", result.stdout.lower())

    def test_codex_is_not_a_generation_harness(self):
        result = subprocess.run(
            [
                "bash", str(SCRIPT_PATH),
                "--harness", "codex",
                "--task", "001",
                "--models", "example-model",
                "--dry-run",
                "--skip-build",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("--harness must be opencode or openhands", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_supported_harnesses_route_dry_runs(self):
        harness_options = (
            ("opencode", "OPENCODE_SKIP_BUILD", "--max-steps"),
            ("openhands", "OPENHANDS_SKIP_BUILD", "--max-iterations"),
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            repo_root = Path(temporary_directory)
            tasks_root = repo_root / "data" / "tasks"
            tasks_root.mkdir(parents=True)
            (tasks_root / "joyfrontbench-001.md").write_text("Build a page.\n")
            script_path = repo_root / "src" / "scripts" / "run-benchmark.sh"
            script_path.parent.mkdir(parents=True)
            shutil.copyfile(SCRIPT_PATH, script_path)

            for harness, skip_build_env, step_option in harness_options:
                with self.subTest(harness=harness):
                    harness_scripts = repo_root / "src" / "generation" / harness / "scripts"
                    harness_scripts.mkdir(parents=True)
                    runner = harness_scripts / "run.sh"
                    runner.write_text(
                        "#!/usr/bin/env bash\n"
                        f'printf \'skip-build:%s\\n\' "${{{skip_build_env}:-}}"\n'
                        'printf \'arg:%s\\n\' "$@"\n',
                        encoding="utf-8",
                    )
                    runner.chmod(0o755)
                    builder = harness_scripts / "build-image.sh"
                    builder.write_text(
                        "#!/usr/bin/env bash\nexit 99\n", encoding="utf-8"
                    )
                    builder.chmod(0o755)

                    result = subprocess.run(
                        [
                            "bash", str(script_path),
                            "--harness", harness,
                            "--task", "001",
                            "--models", "example-model",
                            "--max-steps", "25",
                            "--run-id", "test-run",
                            "--dry-run",
                            "--skip-build",
                        ],
                        capture_output=True,
                        text=True,
                        check=False,
                    )

                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("skip-build:true\n", result.stdout)
                    self.assertIn("arg:run\n", result.stdout)
                    self.assertIn(f"arg:{step_option}\narg:25\n", result.stdout)
                    self.assertIn("arg:--dry-run\n", result.stdout)
                    self.assertIn("Passed: 1", result.stdout)


if __name__ == "__main__":
    unittest.main()
