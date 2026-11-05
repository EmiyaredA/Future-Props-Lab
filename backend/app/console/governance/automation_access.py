"""Enforce the same explicit business allowlist at both website ingresses."""

from app.runtime.website import path_pattern
from fpl_runtime.automation_manifest import automation_manifest

MANIFEST = automation_manifest()


OPERATIONS = [
    (key.split(" ", 1)[0], path_pattern(key.split(" ", 1)[1])) for key in MANIFEST["operations"]
]


def automation_allowed(method, path):
    if (method, path) in {
        ("GET", "/v1/automation/capabilities"),
        ("POST", "/v1/automation/open"),
    }:
        return True
    return any(verb == method and pattern.fullmatch(path) for verb, pattern in OPERATIONS)
