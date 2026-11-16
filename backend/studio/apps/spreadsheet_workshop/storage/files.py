"""Opaque private originals; a crash never removes possibly committed bytes."""

import os
import re
from pathlib import Path
from uuid import uuid4


class Originals:
    def __init__(self, root: Path):
        self.root = root / "originals"

    def initialize(self):
        if self.root.is_symlink():
            raise ValueError("表格原件目录不能是符号链接")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def path(self, key):
        if not re.fullmatch(r"[a-f0-9]{32}", key):
            raise ValueError("原件标识无效")
        path = self.root / key
        if path.is_symlink():
            raise ValueError("原件不能是符号链接")
        return path

    def write(self, content):
        key = uuid4().hex
        path = self.path(key)
        with path.open("xb") as stream:
            path.chmod(0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(self.root, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return key

    def recover(self, referenced):
        self.initialize()
        for path in self.root.iterdir():
            if path.is_symlink() or not path.is_file():
                raise ValueError("表格原件目录含无效文件")
            if re.fullmatch(r"[a-f0-9]{32}", path.name) and path.name not in referenced:
                path.unlink()
