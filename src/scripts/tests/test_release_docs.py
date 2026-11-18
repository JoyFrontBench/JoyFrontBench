import json
import re
import subprocess
import unittest
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
README_PATHS = (REPO_ROOT / "README.md", REPO_ROOT / "README.zh-CN.md")


class ReleaseDocumentationTests(unittest.TestCase):
    def test_documentation_uses_only_current_entrypoints(self) -> None:
        retired = (
            "run-final-generation.sh", "run-final-all.sh",
            "src/scripts/verify-references.mjs",
            "src/evaluation/scripts/verify-references.mjs",
            "docker-batch-parallel.sh",
        )
        for path in README_PATHS:
            source = path.read_text()
            for entrypoint in retired:
                self.assertNotIn(entrypoint, source)
            self.assertIn("src/scripts/run-benchmark.sh", source)
            self.assertIn("--jobs 2", source)
            self.assertIn("src/evaluation/scripts/cli.mjs references:verify", source)
            self.assertIn("--expected-runs=1 --jobs=1", source)
        reference_guide = (REPO_ROOT / "data/references/README.md").read_text()
        self.assertNotIn("src/scripts/verify-references.mjs", reference_guide)
        self.assertIn("src/evaluation/scripts/cli.mjs references:verify", reference_guide)

    def test_readme_examples_match_and_have_valid_shell_syntax(self) -> None:
        examples = [
            re.findall(r"```(bash|dotenv)\n(.*?)\n```", path.read_text(), re.DOTALL)
            for path in README_PATHS
        ]
        self.assertEqual(examples[0], examples[1])
        self.assertGreater(len(examples[0]), 5)
        for language, source in examples[0]:
            if language != "bash":
                continue
            result = subprocess.run(
                ["bash", "-n"], input=source, capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            for script in re.findall(r"\./([\w/.-]+\.sh)", source):
                self.assertTrue((REPO_ROOT / script).is_file(), script)

    def test_local_documentation_links_resolve(self) -> None:
        documents = (
            *README_PATHS,
            REPO_ROOT / "data/references/README.md",
        )
        for document in documents:
            for target in re.findall(r"\[[^\]]+\]\(([^)\s]+)\)", document.read_text()):
                if "://" in target or target.startswith("#"):
                    continue
                relative_path = target.split("#", 1)[0]
                with self.subTest(document=document.name, target=target):
                    self.assertTrue((document.parent / relative_path).exists())

    def test_dataset_preserves_public_question_ids_and_comparison_modes(self) -> None:
        dataset_root = REPO_ROOT / "data"
        questions = json.loads((dataset_root / "dataset.json").read_text())["questions"]
        self.assertEqual(len(questions), 30)
        self.assertEqual([question["number"] for question in questions], list(range(1, 31)))
        for directory, key in (("tasks", "prompt_file"), ("judge", "judge_file")):
            self.assertEqual(
                {path.name for path in (dataset_root / directory).iterdir()},
                {Path(question[key]).name for question in questions},
            )
        task_counts = Counter()
        criterion_counts = Counter()
        pairwise_ids = set()
        for question in questions:
            identifier = f"frontenjoyai-{question['number']:03}"
            self.assertEqual(identifier, question["id"])
            self.assertEqual(
                Path(question["prompt_file"]).stem,
                f"joyfrontbench-{question['number']:03}",
            )
            self.assertEqual(Path(question["judge_file"]).stem, identifier)
            rubric = json.loads((dataset_root / question["judge_file"]).read_text())
            has_pairwise = any(task["judge_mode"] == "pairwise_gsb" for task in rubric["tasks"])
            if has_pairwise:
                pairwise_ids.add(identifier)
            for task in rubric["tasks"]:
                task_counts[task["judge_mode"]] += 1
                criterion_counts[task["judge_mode"]] += len(task["criteria"])
        manifest = json.loads((REPO_ROOT / "data/references/manifest.json").read_text())
        self.assertEqual(pairwise_ids, {question["id"] for question in manifest["questions"]})
        scenes = sum(question["scene_count"] for question in manifest["questions"])
        frames = sum(question["frame_count"] for question in manifest["questions"])
        english = re.sub(r"\s+", " ", README_PATHS[0].read_text().replace("**", ""))
        chinese = re.sub(r"\s+", " ", README_PATHS[1].read_text().replace("**", ""))
        self.assertIn(f"{sum(task_counts.values())} rubric tasks", english)
        self.assertIn(f"{sum(task_counts.values())} 个评分任务", chinese)
        self.assertIn(
            f"{task_counts['pointwise']} pointwise tasks with {criterion_counts['pointwise']} pointwise criteria",
            english,
        )
        self.assertIn(
            f"{task_counts['pairwise_gsb']} pairwise tasks with {criterion_counts['pairwise_gsb']} comparison dimensions",
            english,
        )
        self.assertIn(
            f"{task_counts['pointwise']} 个 pointwise 任务、{criterion_counts['pointwise']} 条 pointwise 判据",
            chinese,
        )
        self.assertIn(
            f"{task_counts['pairwise_gsb']} 个 pairwise 任务、{criterion_counts['pairwise_gsb']} 个比较维度",
            chinese,
        )
        self.assertIn(f"{scenes} reference scenes and {frames} PNG images", english)
        self.assertIn(f"{scenes} 个参考场景、{frames} 张 PNG 图片", chinese)
        self.assertIn(f"{len(manifest['questions'])} pairwise tasks", english)
        self.assertNotIn(f"{sum(criterion_counts.values())} atomic criteria", english)
        self.assertNotIn(f"{sum(criterion_counts.values())} 条原子判据", chinese)

    def test_publication_identity_matches_paper(self) -> None:
        logo = REPO_ROOT / "assets/joyfrontbench-logo.png"
        self.assertEqual(logo.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        titles = (
            "Evaluating Front-End Coding Agents through Goal-Oriented Acceptance Contracts",
            "通过目标导向的验收契约评估前端 Coding Agent",
        )
        for document, title in zip(README_PATHS, titles):
            content = document.read_text()
            self.assertIn("<h2>JoyFrontBench</h2>", content)
            self.assertIn(
                f"<p><strong>{title}</strong></p>",
                content,
            )
            self.assertIn(
                "JoyFrontBench: Evaluating Front-End Coding Agents through Goal-Oriented Acceptance Contracts",
                content,
            )
            self.assertIn("https://arxiv.org/abs/2611.14952", content)
            self.assertIn("Paper-arXiv%3A2611.14952", content)
            self.assertIn('<a href="https://joyfrontbench.github.io/">', content)
            self.assertIn("Website-joyfrontbench.github.io-", content)
            self.assertIn("assets/joyfrontbench-logo.png", content)
            self.assertIn("Xiaoyang Ji", content)
            for metric in ("ATS — Average Task Score", "CTPR — Core-Task Pass Rate", "ASR — Application Success Rate"):
                self.assertIn(metric, content)
            for figure in (
                "evaluation-overview.png", "capability-scores.png", "category-asr-heatmap.png", "quality-efficiency-asr.png",
            ):
                self.assertIn(f"assets/{figure}", content)
                self.assertTrue((REPO_ROOT / "assets" / figure).is_file())
            self.assertNotRegex(content, r"\b(?:ORS|TSR|D-ORS)\b|FrontEnJoyAI-Bench|ARXIV_ID|PROJECT_PAGE")

    def test_root_license_is_linked_without_repeating_its_text(self) -> None:
        notice = (REPO_ROOT / "LICENSE").read_text()
        self.assertTrue(notice.startswith("MIT License\n"))
        self.assertIn("Permission is hereby granted, free of charge", notice)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', notice)
        for document in README_PATHS:
            content = document.read_text()
            self.assertIn("](LICENSE)", content)
            self.assertNotIn("Permission is hereby granted", content)
            self.assertNotIn('THE SOFTWARE IS PROVIDED "AS IS"', content)
        self.assertEqual(
            {path.name for path in (REPO_ROOT / "data/references").iterdir() if path.is_file()},
            {"README.md", "manifest.json"},
        )
        directory = REPO_ROOT / "src/evaluation"
        package = json.loads((directory / "package.json").read_text())
        lock = json.loads((directory / "package-lock.json").read_text())
        self.assertNotIn("license", package)
        self.assertNotIn("license", lock["packages"][""])
        for harness in ("common", "opencode", "openhands"):
            directory = REPO_ROOT / "src" / "generation" / harness
            self.assertNotRegex((directory / "pyproject.toml").read_text(), r"(?m)^license\s*=")
            if harness != "common":
                self.assertIn("COPY LICENSE ", (directory / "Dockerfile").read_text())
        self.assertIn("COPY LICENSE ", (REPO_ROOT / "src/evaluation/Dockerfile").read_text())


if __name__ == "__main__":
    unittest.main()
