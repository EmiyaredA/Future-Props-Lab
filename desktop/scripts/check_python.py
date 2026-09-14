"""Syntax check without importing application modules or writing bytecode."""

import ast
from pathlib import Path

root = Path(__file__).resolve().parents[2]
for folder in ("backend", "db", "desktop/backend"):
    for file in (root / folder).rglob("*.py"):
        try:
            ast.parse(file.read_text(encoding="utf-8"), filename=str(file.relative_to(root)))
        except SyntaxError as error:
            # Do not print the source line: configuration literals may contain secrets.
            raise SystemExit(
                f"Python 语法检查失败：{file.relative_to(root)}:{error.lineno}"
            ) from None
