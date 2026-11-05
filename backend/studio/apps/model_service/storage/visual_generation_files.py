"""Local input/output paths for Models-owned generation; no task or runner lifecycle."""

from pathlib import Path

from studio.apps.model_service.catalog.visual_generation import VisualGenerationValidationError


class VisualGenerationFiles:
    def __init__(self, database_root: Path):
        self.database_root = database_root.resolve()
        self.root = self.database_root / ".visual-generation"

    @staticmethod
    def segment(value):
        if (
            not isinstance(value, str)
            or not value
            or value in {".", ".."}
            or any(separator in value for separator in ("/", "\\"))
        ):
            raise ValueError("生成文件标识无效")
        return value

    def account_root(self, owner):
        account = self.root / self.segment(owner)
        if self.root.is_symlink() or account.is_symlink():
            raise ValueError("生成文件目录不能经过符号链接")
        return account

    def staging_root(self, owner):
        root = self.account_root(owner) / "inputs"
        if root.is_symlink() or not root.resolve().is_relative_to(self.database_root):
            raise VisualGenerationValidationError(
                "生成素材暂存目录不可用", code="visual_generation_staging_unavailable", status=503
            )
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        return root

    def output_root(self, owner):
        directory = self.account_root(owner) / "outputs"
        if directory.is_symlink() or not directory.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("模型生成结果目录不可用")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        return directory

    def input_path(self, owner, input_key, asset_id):
        directory = self.staging_root(owner) / self.segment(input_key)
        path = directory / self.segment(asset_id)
        if (
            directory.is_symlink()
            or path.is_symlink()
            or not path.resolve().is_relative_to(directory.resolve())
            or not path.is_file()
        ):
            raise ValueError("生成参考素材文件已不存在")
        return path
