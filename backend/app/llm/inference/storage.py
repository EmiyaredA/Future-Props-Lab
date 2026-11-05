"""Models-owned inference files, independent of Identity and Assets records."""

from pathlib import Path

from app.runtime.config import get_settings


class InferenceStorage:
    def __init__(self, settings):
        self.accounts_root = settings.runtime_path / "accounts"

    def root(self, owner_user_id):
        if (
            not isinstance(owner_user_id, str)
            or not owner_user_id
            or owner_user_id in {".", ".."}
            or Path(owner_user_id).name != owner_user_id
        ):
            raise ValueError("invalid account id")
        account = self.accounts_root / owner_user_id
        root = account / "model-inference"
        for path in (self.accounts_root, account, root, root / "inputs", root / "outputs"):
            if path.is_symlink():
                raise ValueError("inference storage does not follow symbolic links")
        return root

    def account_ids(self):
        if self.accounts_root.is_symlink():
            raise ValueError("inference storage does not follow symbolic links")
        if not self.accounts_root.is_dir():
            return ()
        result = []
        for path in sorted(self.accounts_root.iterdir()):
            if path.is_symlink() or not path.is_dir():
                continue
            candidate = path / "model-inference"
            if candidate.is_symlink() or not candidate.is_dir():
                continue
            self.root(path.name)
            result.append(path.name)
        return tuple(result)

    def cleanup_uncommitted(self, inputs, outputs):
        owners = set(self.account_ids()) | {owner for owner, _key in inputs | outputs}
        for owner in sorted(owners):
            for kind, references in (("outputs", outputs), ("inputs", inputs)):
                directory = self.root(owner) / kind
                if not directory.is_dir():
                    continue
                for path in directory.iterdir():
                    if (
                        not path.is_symlink()
                        and path.is_file()
                        and (owner, path.name) not in references
                    ):
                        path.unlink(missing_ok=True)


def root(owner_user_id):
    return InferenceStorage(get_settings()).root(owner_user_id)
