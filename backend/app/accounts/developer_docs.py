"""Serve an allowlisted documentation projection only after principal authorization."""

from pathlib import Path

from app.accounts.errors import AccountError

ROOT = Path(__file__).resolve().parents[3]


def developer_documents(principal):
    if not principal.allows("docs.developer"):
        raise AccountError("developer_docs_required")
    paths = [ROOT / "README.md", ROOT / "CONTRIBUTING.md", ROOT / "docs/assets/MANIFEST.md"]
    for directory in ("architecture", "operations", "reference"):
        paths.extend(sorted((ROOT / "docs" / directory).glob("*.md")))
    result = []
    for path in paths:
        if not path.is_file() or path.name == "api.md":
            continue
        raw = path.read_text(encoding="utf-8")
        result.append(
            {
                "id": "dev-" + path.stem,
                "source": "../../../" + str(path.relative_to(ROOT)),
                "group": "engineering" if "architecture" in path.parts else "operations",
                "markdown": raw,
            }
        )
    return {"items": result}
