"""Small AST policies shared by architecture checks and their negative examples."""

import ast
from importlib.util import resolve_name


def dependencies(source: str, module: str, *, package: bool = False) -> set[str]:
    """Include type-only and function-local imports: neither may hide ownership."""
    result = set()
    owner = module if package else module.rpartition(".")[0]
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            target = (
                resolve_name("." * node.level + (node.module or ""), owner)
                if node.level
                else node.module or ""
            )
            result.add(target)
            result.update(target + "." + alias.name for alias in node.names)
        elif (
            isinstance(node, ast.Call)
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            function = ast.unparse(node.func)
            if function in {"__import__", "importlib.import_module"}:
                result.add(node.args[0].value)
    return result


def foreign_storage(source: str, module: str, *, package: bool = False) -> set[str]:
    if len(module.split(".")) < 3:
        return set()
    owner = module.split(".")[2]
    return {
        target
        for target in dependencies(source, module, package=package)
        if target.startswith("studio.apps.")
        and len(parts := target.split(".")) > 3
        and parts[2] != owner
        and ("storage" in parts[3:] or "models" in parts[3:] or "orm" in parts[3:])
    }


def discovers_tables(source: str) -> bool:
    return any(
        isinstance(node, ast.Attribute)
        and node.attr == "tables"
        and isinstance(node.value, ast.Attribute)
        and node.value.attr == "metadata"
        for node in ast.walk(ast.parse(source))
    )


def route_handlers(source: str):
    methods = {"get", "put", "post", "patch", "delete", "head", "options", "websocket"}
    return [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and any(
            isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Attribute)
            and decorator.func.attr in methods
            for decorator in node.decorator_list
        )
    ]
