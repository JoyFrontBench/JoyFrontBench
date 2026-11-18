import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(
    os.environ.get("FRONT_TEST_DOCKER_CONTEXT") == "1",
    "Set FRONT_TEST_DOCKER_CONTEXT=1 to check a synthetic context with Docker.",
)
class DockerContextTests(unittest.TestCase):
    def test_context_excludes_credentials_and_reference_source(self) -> None:
        allowed = {
            ".env.example",
            "LICENSE",
            "README.md",
            "README.zh-CN.md",
            "data/tasks/joyfrontbench-001.md",
            "data/dataset.json",
            "data/judge/frontenjoyai-001.json",
            "src/data-tools/annotate-core-criteria.mjs",
            "src/evaluation/.env.example",
            "src/evaluation/package.json",
            "src/evaluation/package-lock.json",
            "src/evaluation/scripts/docker-entrypoint.sh",
            "src/evaluation/scripts/cli.mjs",
            "src/evaluation/scripts/lib/config.mjs",
            "src/evaluation/scripts/lib/core-scoring.mjs",
            "src/evaluation/scripts/lib/pipeline.mjs",
            "src/evaluation/scripts/lib/docker-executor.mjs",
            "src/evaluation/scripts/lib/tasks.mjs",
            "src/evaluation/skills/pipeline/SKILL.md",
            "src/evaluation/skills/page-evaluation/topics/octopus-drum-svg/SKILL.md",
            "src/evaluation/skills/report-generation/SKILL.md",
            "src/evaluation/skills/judge/SKILL.md",
            "src/evaluation/skills/final-score/SKILL.md",
            "src/evaluation/skills/batch-evaluation/SKILL.md",
            "src/generation/opencode/src/front_opencode/cli.py",
            "src/generation/openhands/src/front_openhands/cli.py",
            "src/generation/common/pyproject.toml",
            "src/generation/common/src/front_generation/defaults.py",
            "src/generation/common/src/front_generation/cli.py",
            "src/generation/common/src/front_generation/models.py",
            "src/generation/common/src/front_generation/paths.py",
            "src/generation/common/src/front_generation/tasks.py",
            "src/generation/scripts/front-playwright-check.sh",
            "src/generation/scripts/run-harness.sh",
            "src/generation/playwright-version.txt",
            "data/references/README.md",
            "data/references/manifest.json",
            "data/references/frontenjoyai-001/scenes.json",
            "data/references/frontenjoyai-001/images/curve-editor-01.png",
        }
        forbidden = {
            ".env",
            ".env.candidate",
            ".env.judge",
            ".env.local",
            ".env.pod",
            "nested/.env",
            "nested/.env.local",
            "nested/deep/.env.private",
            "data/references/source.zip",
            "data/references/private.txt",
            "data/references/frontenjoyai-001/index.html",
            "data/references/frontenjoyai-001/package.json",
            "data/references/frontenjoyai-001/src/private.js",
            "data/references/frontenjoyai-001/images/private.wasm",
            "data/references/frontenjoyai-001/images/nested/private.png",
            "data/references/frontenjoyai-001/node_modules/private/index.js",
            "data/references/private-app/src/index.js",
            "runs/private/output.json",
            "eval-output/private.json",
            "src/evaluation/eval-output/private.json",
            "src/evaluation/.env",
            "src/generation/opencode/.venv/private.py",
            "src/generation/openhands/.venv/private.py",
            "src/scripts/__pycache__/private.cpython-312.pyc",
            "private.pyc",
            "src/private.pyo",
        }
        with tempfile.TemporaryDirectory(prefix="front-docker-context-") as directory:
            root = Path(directory)
            context = root / "context"
            output = root / "output"
            context.mkdir()
            shutil.copyfile(REPO_ROOT / ".dockerignore", context / ".dockerignore")
            (context / "Dockerfile").write_text("FROM scratch\nCOPY . /\n")
            for relative_path in sorted(allowed | forbidden):
                path = context / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("Synthetic public-release boundary test.\n")
            result = subprocess.run(
                [
                    "docker", "build", "--network=none", "--progress=plain",
                    "--output", f"type=local,dest={output}", str(context),
                ],
                capture_output=True,
                text=True,
                timeout=120,
                env={**os.environ, "DOCKER_BUILDKIT": "1"},
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            exported = {
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            }
            self.assertEqual(sorted(forbidden & exported), [])
            self.assertEqual(sorted(allowed - exported), [])


if __name__ == "__main__":
    unittest.main()
