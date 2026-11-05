"""Read only the allowlisted installed engineering documents."""


class InstalledDocuments:
    def __init__(self, root):
        self.root = root

    def read(self):
        paths = [
            self.root / "README.md",
            self.root / "CONTRIBUTING.md",
            self.root / "docs/assets/MANIFEST.md",
        ]
        for directory in ("architecture", "operations", "reference"):
            paths.extend(sorted((self.root / "docs" / directory).glob("*.md")))
        result = []
        for path in paths:
            if not path.is_file() or path.name == "api.md":
                continue
            raw = path.read_text(encoding="utf-8")
            result.append(
                {
                    "id": "dev-" + path.stem,
                    "source": "../../../" + str(path.relative_to(self.root)),
                    "group": "engineering" if "architecture" in path.parts else "operations",
                    "markdown": raw,
                }
            )
        return result
