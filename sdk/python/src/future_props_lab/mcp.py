"""Small stdio MCP surface over the website SDK, with no backend imports."""

import base64
import json
import mimetypes
import os
import socket
import sys
from contextlib import ExitStack
from pathlib import Path

from .encoding import encode
from .website import website_client


def tool(name, description, properties=None, required=()):
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


def external_tools():
    return [
        tool(
            "operations",
            "Discover allowed FPL SDK operations and their schemas",
            {"operation": {"type": "string"}},
        ),
        tool(
            "call",
            "Call a registered FPL SDK operation with its exact keyword parameters. "
            "Read before editing and supply the current revision. Never retry unknown writes.",
            {
                "operation": {"type": "string"},
                "parameters": {"type": "object"},
                "files": {
                    "type": "array",
                    "maxItems": 10,
                    "items": {
                        "type": "object",
                        "properties": {"field": {"type": "string"}, "path": {"type": "string"}},
                        "required": ["field", "path"],
                        "additionalProperties": False,
                    },
                },
            },
            ("operation", "parameters"),
        ),
        tool(
            "open",
            "Get an authorized website resource link",
            {"kind": {"type": "string"}, "resource_id": {"type": "string"}},
            ("kind",),
        ),
    ]


def serve(handler, tools, *, input_stream=None, output_stream=None, content_blocks=False):
    source, destination = input_stream or sys.stdin, output_stream or sys.stdout
    for line in source:
        request = None
        try:
            if len(line.encode()) > 2 * 1024 * 1024:
                raise ValueError("MCP request too large")
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Invalid JSON-RPC request")
            if "id" not in request:
                continue
            method, params = request.get("method"), request.get("params", {})
            if method == "initialize":
                result = {
                    "protocolVersion": params.get("protocolVersion", "2025-03-26"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "future-props-lab", "version": "1.0.0"},
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": tools}
            elif method == "tools/call":
                if params.get("name") not in {t["name"] for t in tools}:
                    raise ValueError("Unknown tool")
                try:
                    value = handler(params["name"], params.get("arguments", {}))
                    content = (
                        value
                        if content_blocks and isinstance(value, list)
                        else [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}]
                    )
                    result = {"content": content, "isError": False}
                except Exception:
                    # API errors and local paths can carry private payloads. Do not echo them.
                    result = {
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "FPL tool failed; check authorization, parameters "
                                    "and resource state. "
                                    "Writes are not retried."
                                ),
                            }
                        ],
                        "isError": True,
                    }
            else:
                raise ValueError("Unsupported MCP method")
            response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
        except (ValueError, TypeError, KeyError):
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if isinstance(request, dict) else None,
                "error": {"code": -32600, "message": "Invalid MCP request"},
            }
        destination.write(json.dumps(response, ensure_ascii=False) + "\n")
        destination.flush()


def run_external(**options):
    from .cli import capability, operation

    with website_client(**options) as client:

        def call(name, arguments):
            # Fetch fresh authority for every tool call; never cache a revoked key's capabilities.
            catalog = capability(client)
            if name == "operations":
                identity = arguments.get("operation")
                if identity:
                    operation(client, identity, catalog)
                    return {
                        "operation": catalog["operations"][identity],
                        "schemas": catalog["schemas"],
                    }
                return {"operations": catalog["operations"]}
            if name == "open":
                return client._call(
                    "POST", "/v1/automation/open", body=arguments, media_type="application/json"
                )
            parameters = arguments.get("parameters", {})
            if not isinstance(parameters, dict):
                raise ValueError("Invalid parameters")
            if "files" in parameters:
                raise ValueError("Use the explicit files input for uploads")
            with ExitStack() as stack:
                files = []
                for item in arguments.get("files", []):
                    path = Path(item["path"])
                    files.append(
                        (
                            item["field"],
                            (
                                path.name,
                                stack.enter_context(path.open("rb")),
                                mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                            ),
                        )
                    )
                if files:
                    parameters = {**parameters, "files": files}
                value = operation(client, arguments["operation"], catalog)(**parameters)
                if hasattr(value, "read"):
                    with value:
                        data = bytearray()
                        for chunk in value.iter_bytes():
                            data.extend(chunk)
                            if len(data) > 1024 * 1024:
                                raise ValueError("Use fpl call --output for large downloads")
                    return {"base64": base64.b64encode(data).decode()}
                return encode(value)

        serve(call, external_tools())


def run_relay():
    """Internal run-scoped relay; this token cannot authenticate any FPL HTTP API."""
    endpoint, token = os.environ["FPL_TOOL_SOCKET"], os.environ["FPL_TOOL_TOKEN"]
    tools = json.loads(os.environ["FPL_TOOL_DEFINITIONS"])
    timeout = max(1, min(900, int(os.environ.get("FPL_TOOL_TIMEOUT", "120"))))

    def call(name, arguments):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(timeout)
            connection.connect(endpoint)
            connection.sendall(
                json.dumps({"token": token, "name": name, "arguments": arguments}).encode() + b"\n"
            )
            with connection.makefile("rb") as stream:
                result = json.loads(stream.readline(2 * 1024 * 1024))
            if "error" in result:
                raise ValueError(result["error"])
            return result["result"]

    serve(call, tools, content_blocks=True)
