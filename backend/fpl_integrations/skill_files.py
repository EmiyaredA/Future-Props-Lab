"""Startup reconciliation resolves Skill filesystem work from a definitive owned snapshot."""

import re
import shutil
from uuid import UUID

from sqlalchemy import select

from app.integrations.models import SkillIntegration, SkillVersion
from app.integrations.skills.archive import SkillArchiveStorage


def identity(value):
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def regular_directory(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Skill storage contains an unsafe directory")


def no_links(path):
    regular_directory(path)
    for child in path.rglob("*"):
        if child.is_symlink() or not (child.is_dir() or child.is_file()):
            raise ValueError("Skill storage contains an unsafe entry")


async def reconcile_skill_files(database, settings):
    async with database.sessions(info={"allow_system_reads": True}) as session:
        skills = list(await session.scalars(select(SkillIntegration)))
        versions = list(await session.scalars(select(SkillVersion)))
    owners = {row.id: row.owner_user_id for row in skills}
    expected = {(row.skill_id, row.version) for row in versions}
    trash = settings.storage_trash_path / "integrations"
    if trash.exists():
        regular_directory(trash.parent)
        regular_directory(trash)
        for staged in trash.iterdir():
            match = re.fullmatch(r"([0-9a-f-]{36})--trash--[0-9a-f]{32}", staged.name)
            if match is None or not identity(match[1]):
                raise ValueError("Skill trash contains an unknown entry")
            no_links(staged)
            owner = owners.get(match[1])
            if owner:
                destination = SkillArchiveStorage(settings, owner).root / match[1]
                if destination.exists():
                    raise ValueError("Skill trash restore conflicts with an existing version")
                destination.parent.mkdir(parents=True, exist_ok=True)
                staged.rename(destination)
            else:
                shutil.rmtree(staged)
    accounts = settings.runtime_path / "accounts"
    if accounts.exists():
        regular_directory(accounts)
        for account in accounts.iterdir():
            regular_directory(account)
            root = account / "integrations" / "skills"
            if not root.exists():
                continue
            regular_directory(account / "integrations")
            regular_directory(root)
            for skill in root.iterdir():
                if skill.name.startswith((".staging-", ".upload-")):
                    if not re.fullmatch(r"\.(staging|upload)-[a-f0-9]{32}(\.zip)?", skill.name):
                        raise ValueError("Skill staging contains an unknown entry")
                    if skill.is_symlink():
                        raise ValueError("Skill staging cannot be a symbolic link")
                    if skill.is_dir():
                        shutil.rmtree(skill)
                    elif skill.is_file():
                        skill.unlink()
                    continue
                if not identity(skill.name):
                    raise ValueError("Skill storage contains an unknown Skill ID")
                no_links(skill)
                if owners.get(skill.name) != account.name:
                    if skill.name in owners:
                        raise ValueError("Skill content is under another account")
                    shutil.rmtree(skill)
                    continue
                for version in skill.iterdir():
                    if not re.fullmatch(r"v[1-9][0-9]*", version.name):
                        raise ValueError("Skill storage contains an unknown version")
                    regular_directory(version)
                    if (skill.name, version.name) not in expected:
                        shutil.rmtree(version)
    for skill_id, version in expected:
        if skill_id not in owners:
            raise ValueError("Skill version has no owned Skill")
        root = SkillArchiveStorage(settings, owners[skill_id]).final_path(skill_id, version)
        no_links(root)
        markdown = [entry for entry in root.iterdir() if entry.name.casefold() == "skill.md"]
        if len(markdown) != 1 or not markdown[0].is_file():
            raise ValueError("Skill version content is missing SKILL.md")
