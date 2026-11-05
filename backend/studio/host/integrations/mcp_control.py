"""Execute only locally registered MCP launches, without inheriting personal configuration."""

import json
import os
from dataclasses import asdict
from pathlib import Path

from studio.apps.integrations.mcp.client import OfficialMcpDiscoveryClient
from studio.contracts.integrations.integration_intents import digest
from studio.contracts.integrations.native import McpLaunch, McpNativePayload
from studio.runtime.secrets import redact_structure


class McpControl:
    def __init__(self, profiles, state_root):
        self.root = state_root.resolve()
        self.profiles = {}
        for profile in profiles:
            if set(profile) != {"command", "arguments", "environment_keys"}:
                raise ValueError("MCP profile requires command, arguments and environment_keys")
            executable = Path(profile["command"])
            if not executable.is_absolute() or not executable.is_file():
                raise ValueError("MCP profile executable must be an existing absolute file")
            if not isinstance(profile["arguments"], list) or not all(
                isinstance(arg, str) for arg in profile["arguments"]
            ):
                raise ValueError("MCP profile arguments must be strings")
            keys = profile["environment_keys"]
            if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
                raise ValueError("MCP profile environment keys must be strings")
            checksum = digest({"command": str(executable), "arguments": profile["arguments"]})
            if checksum in self.profiles:
                raise ValueError("MCP profile launches must be unique")
            self.profiles[checksum] = profile

    def observe(self):
        return {"profiles": sorted(self.profiles)}

    async def execute(self, lease, launch):
        from mcp import Client
        from mcp.client.stdio import DEFAULT_INHERITED_ENV_VARS, StdioServerParameters, stdio_client

        payload = McpNativePayload.model_validate(lease.payload)
        launch = McpLaunch.model_validate(launch)
        profile = self.profiles.get(payload.launch_sha256)
        if (
            profile is None
            or launch.operation != lease.operation
            or launch.launch_sha256 != payload.launch_sha256
        ):
            raise ValueError("MCP launch is not a registered local profile")
        if (
            digest({"command": launch.command, "arguments": launch.arguments})
            != payload.launch_sha256
        ):
            raise ValueError("MCP executable or arguments changed")
        if (
            digest(launch.tool_arguments) != payload.input_sha256
            or launch.tool_name != payload.tool_name
            or launch.sensitive_result != payload.sensitive_result
        ):
            raise ValueError("MCP invocation differs from original lease")
        if set(launch.environment) - set(profile["environment_keys"]):
            raise ValueError("MCP environment keys have not been registered locally")
        # SDK defaults otherwise include the user's HOME and PATH. An empty task home
        # prevents an approved server from implicitly loading personal CLI settings.
        home = self.root / "homes" / str(lease.job_id)
        if home.is_symlink() or home.parent.is_symlink():
            raise ValueError("MCP task home cannot be a symlink")
        home.mkdir(parents=True, exist_ok=True, mode=0o700)
        environment = {key: "" for key in DEFAULT_INHERITED_ENV_VARS}
        environment.update(launch.environment)
        environment.update(
            HOME=str(home),
            USERPROFILE=str(home),
            XDG_CONFIG_HOME=str(home / ".config"),
            XDG_CACHE_HOME=str(home / ".cache"),
        )
        parameters = StdioServerParameters(
            command=launch.command, args=launch.arguments, env=environment, cwd=str(home)
        )
        with open(os.devnull, "w") as errors:
            return await self._invoke(Client, stdio_client, parameters, errors, launch, lease)

    async def _invoke(self, Client, stdio_client, parameters, errors, launch, lease):
        async with Client(stdio_client(parameters, errlog=errors)) as client:
            if lease.operation == "integrations.mcp-discover":
                result = asdict(
                    OfficialMcpDiscoveryClient._result(
                        client, await OfficialMcpDiscoveryClient._all_tools(client)
                    )
                )
            else:
                reply = await client.call_tool(launch.tool_name, launch.tool_arguments)
                result = reply.model_dump(mode="json")
                if launch.sensitive_result:
                    return {"result": "敏感结果已隐藏"}
        encoded = json.dumps(result)
        if len(encoded.encode()) > 1024 * 1024:
            raise ValueError("Native MCP response exceeds 1 MiB")
        return redact_structure(json.loads(encoded), list(launch.environment.values()))
