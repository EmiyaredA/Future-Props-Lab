"""Hash one service's public operations and their reachable schema definitions."""

import hashlib
import json


def public_contract(schema, service, catalog):
    operations = {}
    required = set()

    def references(value):
        if isinstance(value, dict):
            reference = value.get("$ref", "")
            if reference.startswith("#/components/schemas/"):
                required.add(reference.removeprefix("#/components/schemas/"))
            for child in value.values():
                references(child)
        elif isinstance(value, list):
            for child in value:
                references(child)

    for operation in catalog.operations:
        if operation.service != service:
            continue
        value = schema["paths"][operation.path][operation.method.lower()]
        operations[operation.method + " " + operation.path] = value
        references(value)
    definitions = {}
    while required - definitions.keys():
        name = sorted(required - definitions.keys())[0]
        definitions[name] = schema["components"]["schemas"][name]
        references(definitions[name])
    value = {"operations": operations, "schemas": definitions}
    sockets = [
        {"path": item.path, "permission": item.permission}
        for item in catalog.websockets
        if item.service == service
    ]
    if sockets:
        value["websockets"] = sockets
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()
