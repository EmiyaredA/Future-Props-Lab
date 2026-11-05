"""Reversible directory moves; owners decide authorization, roots and transaction boundaries."""

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


@dataclass(frozen=True)
class StagedDirectory:
    original: Path
    staged: Path


def stage_directory(original: Path, trash: Path, identifier: str) -> StagedDirectory | None:
    if not original.exists():
        return None
    if not identifier or Path(identifier).name != identifier or identifier in {".", ".."}:
        raise ValueError("invalid staged directory identifier")
    trash.mkdir(parents=True, exist_ok=True)
    staged = trash / f"{identifier}--trash--{uuid4().hex}"
    os.replace(original, staged)
    return StagedDirectory(original, staged)


def restore_directory(staged: StagedDirectory | None) -> None:
    if staged is None or not staged.staged.exists():
        return
    staged.original.parent.mkdir(parents=True, exist_ok=True)
    os.replace(staged.staged, staged.original)


def purge_directory(staged: StagedDirectory | None) -> None:
    if staged is not None:
        shutil.rmtree(staged.staged, ignore_errors=True)
