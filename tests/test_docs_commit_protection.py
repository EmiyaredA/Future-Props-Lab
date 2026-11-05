"""The CI guard enforces separate product-document commits, not a blanket CI dead end."""

import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check-docs-center-protected.mjs"
DOC = "web/src/docs/articles/sdk/reference.md"


@pytest.fixture
def repository(tmp_path):
    def git(*args):
        return subprocess.check_output(
            [
                "git",
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                *args,
            ],
            cwd=tmp_path,
            text=True,
        ).strip()

    git("init", "--quiet")
    (tmp_path / "baseline.txt").write_text("initial")
    git("add", ".")
    git("commit", "--quiet", "-m", "initial")
    base = git("rev-parse", "HEAD")

    def write(name, content="fixture"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit():
        git("add", ".")
        git("commit", "--quiet", "-m", "fixture update")

    def check(*, compare=True):
        environment = {k: v for k, v in os.environ.items() if k != "DOCS_CENTER_BASE_REF"}
        if compare:
            environment["DOCS_CENTER_BASE_REF"] = base
        return subprocess.run(
            ["node", str(SCRIPT)], cwd=tmp_path, env=environment, capture_output=True, text=True
        )

    return write, commit, check, git


def test_authorized_separate_document_and_code_commits_pass(repository):
    write, commit, check, _git = repository
    write(DOC)
    commit()
    write("backend/owned.py")
    write(".agents/notes/proposed/architecture/note.md")
    commit()
    assert check().returncode == 0


@pytest.mark.parametrize(
    "other", ["backend/owned.py", ".agents/notes/proposed/architecture/note.md"]
)
@pytest.mark.parametrize("document", [DOC, "web/src/docs/articles/中文参考.md"])
def test_mixed_product_document_commits_are_rejected(repository, other, document):
    write, commit, check, _git = repository
    write(document)
    write(other)
    commit()
    result = check()
    assert result.returncode == 1
    assert document in result.stderr and other in result.stderr


def test_uncommitted_protected_content_is_rejected_even_without_a_baseline(repository):
    write, _commit, check, _git = repository
    write(DOC)
    assert check().returncode == 1
    assert check(compare=False).returncode == 1


def test_a_normal_merge_checks_constituent_isolated_commits(repository):
    write, commit, check, git = repository
    git("checkout", "--quiet", "-b", "document-change")
    write(DOC)
    commit()
    git("checkout", "--quiet", "-")
    write("backend/owned.py")
    commit()
    git("merge", "--quiet", "--no-ff", "--no-edit", "document-change")
    assert check().returncode == 0


def test_merge_conflict_resolution_cannot_combine_document_and_code(repository):
    write, commit, check, git = repository
    git("checkout", "--quiet", "-b", "document-change")
    write(DOC, "branch A")
    commit()
    write("backend/owned.py", "branch A")
    commit()
    git("checkout", "--quiet", "-")
    write(DOC, "branch B")
    commit()
    write("backend/owned.py", "branch B")
    commit()
    with pytest.raises(subprocess.CalledProcessError):
        git("merge", "--quiet", "--no-ff", "--no-edit", "document-change")
    write(DOC, "merged")
    write("backend/owned.py", "merged")
    commit()
    assert check().returncode == 1
