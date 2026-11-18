import shlex
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class RepositoryLayoutTests(unittest.TestCase):
    def test_scripts_have_one_public_generation_entry(self) -> None:
        scripts_root = REPO_ROOT / "src/scripts"
        self.assertEqual(
            {path.name for path in scripts_root.iterdir() if path.is_file()},
            {"run-benchmark.sh"},
        )
        self.assertTrue((REPO_ROOT / "src/evaluation/scripts/cli.mjs").is_file())

    def test_evaluation_has_one_cli_and_reusable_modules(self) -> None:
        scripts_root = REPO_ROOT / "src/evaluation/scripts"
        self.assertEqual(
            {path.name for path in scripts_root.iterdir() if path.is_file()},
            {"cli.mjs", "docker-run.sh", "docker-build.sh", "docker-entrypoint.sh"},
        )
        self.assertEqual(
            {path.name for path in (scripts_root / "lib").iterdir()},
            {
                "batch.mjs",
                "capability-scoring.mjs",
                "config.mjs",
                "docker-executor.mjs",
                "judge.mjs",
                "pipeline.mjs",
                "references.mjs",
                "report-writer.mjs",
                "run-workspaces.mjs",
                "scoring.mjs",
                "core-scoring.mjs",
                "tasks.mjs",
            },
        )
        self.assertFalse(
            (REPO_ROOT / "src/evaluation/skills/batch-evaluation/scripts").exists()
        )

    def test_generation_backends_remain_independent_packages(self) -> None:
        generation_root = REPO_ROOT / "src/generation"
        for retired_path in ("harness", "src/harness"):
            self.assertFalse((REPO_ROOT / retired_path).exists())
        for backend in ("opencode", "openhands"):
            for relative_path in (
                "Dockerfile",
                "pyproject.toml",
                "uv.lock",
                "scripts/run.sh",
                "scripts/build-image.sh",
                "scripts/setup.sh",
                "tests/test_runner.py",
            ):
                with self.subTest(backend=backend, path=relative_path):
                    self.assertTrue(
                        (generation_root / backend / relative_path).is_file()
                    )
        for relative_path in (
            "playwright-version.txt",
            "scripts/front-playwright-check.sh",
            "scripts/run-harness.sh",
            "tests/fixtures/model-profiles.json",
        ):
            self.assertTrue((generation_root / relative_path).is_file())

    def test_generation_utilities_are_shared(self) -> None:
        generation_root = REPO_ROOT / "src/generation"
        for module in ("models", "paths", "tasks"):
            self.assertTrue(
                (generation_root / f"common/src/front_generation/{module}.py").is_file()
            )
        for backend in ("opencode", "openhands"):
            for module in ("paths", "tasks"):
                self.assertFalse(
                    (
                        generation_root / f"{backend}/src/front_{backend}/{module}.py"
                    ).exists()
                )

    def test_evaluation_skills_are_grouped_by_role(self) -> None:
        evaluation_root = REPO_ROOT / "src/evaluation"
        self.assertFalse((REPO_ROOT / "src/auto-eval").exists())
        skills = {
            "pipeline",
            "page-evaluation",
            "report-generation",
            "judge",
            "final-score",
            "batch-evaluation",
            "capability-annotation",
        }
        self.assertEqual(
            {path.name for path in (evaluation_root / "skills").iterdir()},
            skills,
        )
        for skill in skills:
            with self.subTest(skill=skill):
                self.assertTrue(
                    (evaluation_root / "skills" / skill / "SKILL.md").is_file()
                )
        self.assertEqual(list(evaluation_root.glob("*-skill")), [])
        topics_root = evaluation_root / "skills/page-evaluation/topics"
        for shared_skill in ("report-generation", "eval-judge", "judge"):
            self.assertFalse((topics_root / shared_skill).exists())

    def test_model_setup_needs_no_registry_file(self) -> None:
        self.assertFalse((REPO_ROOT / "config").exists())
        example_keys = {
            line.split("=", 1)[0]
            for line in (REPO_ROOT / ".env.example").read_text().splitlines()
            if line.strip() and not line.startswith("#")
        }
        self.assertEqual(
            example_keys, {"OPENAI_API_KEY", "OPENAI_BASE_URL", "EVAL_MODEL"}
        )

    def test_data_directory_contains_no_executable_source(self) -> None:
        source_extensions = {
            ".py",
            ".pyc",
            ".pyo",
            ".js",
            ".mjs",
            ".cjs",
            ".ts",
            ".tsx",
            ".jsx",
            ".sh",
        }
        for path in (REPO_ROOT / "data").rglob("*"):
            if path.is_file():
                with self.subTest(path=path.relative_to(REPO_ROOT)):
                    self.assertNotIn(path.suffix, source_extensions)

    def test_docker_copy_sources_resolve_from_repository_root(self) -> None:
        dockerfiles = (
            "src/evaluation/Dockerfile",
            "src/generation/opencode/Dockerfile",
            "src/generation/openhands/Dockerfile",
        )
        for dockerfile in dockerfiles:
            for line in (REPO_ROOT / dockerfile).read_text().splitlines():
                if not line.startswith("COPY "):
                    continue
                arguments = shlex.split(line)
                if any(argument.startswith("--from=") for argument in arguments):
                    continue
                for source in arguments[1:-1]:
                    if source.startswith("--"):
                        continue
                    with self.subTest(dockerfile=dockerfile, source=source):
                        self.assertTrue((REPO_ROOT / source).exists())

    def test_evaluation_docker_reuses_the_package_manifest(self) -> None:
        evaluation_root = REPO_ROOT / "src/evaluation"
        self.assertFalse((evaluation_root / "docker").exists())
        self.assertTrue((evaluation_root / "scripts/docker-entrypoint.sh").is_file())
        dockerfile = (evaluation_root / "Dockerfile").read_text()
        self.assertIn(
            "COPY src/evaluation/package.json src/evaluation/package-lock.json ./",
            dockerfile,
        )
        self.assertIn(
            "COPY src/evaluation/scripts/docker-entrypoint.sh "
            "/usr/local/bin/front-auto-eval",
            dockerfile,
        )


if __name__ == "__main__":
    unittest.main()
