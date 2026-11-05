"""Enforce the same explicit business allowlist at both website ingresses."""

from studio.contracts.gateway.automation_manifest import automation_manifest
from studio.runtime.http.website import path_pattern

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
