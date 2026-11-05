"""Declared Amadeus dialogue tool schemas shared by its two runtime compositions."""

from jsonschema import ValidationError, validate

from studio.runtime.database.operation_receipts import OperationError


def definition(name, description, properties=None, required=()):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties or {},
            "required": list(required),
            "additionalProperties": False,
        },
    }


TOOLS = [
    definition(
        "operations",
        "Discover registered operations; filter resource to get full request schemas",
        {"resource": {"type": "string"}},
    ),
    definition(
        "present_artifact",
        "Present a plan or draft as an editable review card; this does not execute it",
        {
            "kind": {"type": "string", "enum": ["plan", "draft"]},
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "body": {"type": "string", "minLength": 1, "maxLength": 100000},
            "steps": {
                "type": "array",
                "maxItems": 30,
                "items": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                    "required": ["title", "detail"],
                    "additionalProperties": False,
                },
            },
        },
        ("kind", "title", "body", "steps"),
    ),
    definition(
        "call",
        "Read or propose a registered project operation. "
        "Writes require owner approval; stop after a proposal.",
        {"operation": {"type": "string"}, "arguments": {"type": "object"}},
        ("operation", "arguments"),
    ),
    definition("files", "List this conversation's files and hashes"),
    definition(
        "read_file",
        "Read a conversation UTF-8 file or view an image",
        {"kind": {"type": "string"}, "name": {"type": "string"}},
        ("kind", "name"),
    ),
    definition(
        "write_file",
        "Propose writing an output file. Requires approval and the existing SHA256 on replacement.",
        {
            "name": {"type": "string"},
            "content": {"type": "string"},
            "expected_sha256": {"type": "string"},
        },
        ("name", "content"),
    ),
    definition(
        "ask_user",
        "Ask the owner a question, then stop this turn",
        {
            "prompt": {"type": "string"},
            "options": {"type": "array", "items": {"type": "string"}},
            "allow_text": {"type": "boolean"},
        },
        ("prompt",),
    ),
    definition(
        "skill",
        "Load an explicitly selected Skill or read one of its UTF-8 files",
        {"id": {"type": "string"}, "version": {"type": "string"}, "path": {"type": "string"}},
        ("id",),
    ),
    definition("integrations", "List explicitly selected Tool API and MCP capabilities"),
    definition(
        "integration",
        "Propose invoking a selected integration. Requires revision and owner approval.",
        {
            "id": {"type": "string"},
            "tool": {"type": "string"},
            "revision": {"type": "integer"},
            "input": {"type": "object"},
        },
        ("id", "revision", "input"),
    ),
]


SCHEMAS = {tool["name"]: tool["inputSchema"] for tool in TOOLS}


def validate_tool(name, args):
    if name not in SCHEMAS or not isinstance(args, dict):
        raise OperationError("工具参数无效")
    try:
        validate(args, SCHEMAS[name])
    except ValidationError:
        raise OperationError("工具参数与契约不匹配", "invalid_arguments", 422) from None
