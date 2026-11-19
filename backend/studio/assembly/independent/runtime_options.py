"""Explicit filesystem and connection bindings shared by independent CLIs."""

import json
import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

from studio.runtime.http.service_transport import LocalServiceTransport


@dataclass(frozen=True)
class RuntimeLayout:
    paths: dict[str, str] = field(default_factory=dict)
    addresses: dict[str, str] = field(default_factory=dict)

    @classmethod
    def read(cls, path):
        if path is None:
            return cls()
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("本机装配清单必须是本用户独占的普通文件")
        data = json.loads(path.read_text())
        if set(data) != {"paths", "addresses"} or not all(
            isinstance(mapping, dict) for mapping in data.values()
        ):
            raise ValueError("本机装配清单无效")
        for source, destination in data["paths"].items():
            if (
                not isinstance(destination, str)
                or not Path(source).is_absolute()
                or not Path(destination).is_absolute()
            ):
                raise ValueError("本机资源绑定必须使用绝对路径")
        # Validate before constructing any application or opening its database.
        LocalServiceTransport(data["addresses"])
        return cls(**data)

    def path(self, value):
        path = Path(value)
        for source in sorted(self.paths, key=len, reverse=True):
            if path.is_relative_to(source):
                return Path(self.paths[source]) / path.relative_to(source)
        return path

    def transport(self):
        return LocalServiceTransport(self.addresses) if self.addresses else None


def add_runtime_options(parser):
    parser.add_argument("--runtime-layout", type=Path)
    parser.add_argument("--host", default="0.0.0.0", choices=("0.0.0.0", "127.0.0.1"))


def parse_runtime_arguments(parser):
    options = parser.parse_args()
    runtime = RuntimeLayout.read(options.runtime_layout)
    for name, value in vars(options).copy().items():
        if isinstance(value, Path) and name != "runtime_layout":
            setattr(options, name, runtime.path(value))
    options.runtime = runtime
    return options


def runtime_for(options):
    return getattr(options, "runtime", RuntimeLayout())
