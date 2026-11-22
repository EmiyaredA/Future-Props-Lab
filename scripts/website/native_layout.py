"""Project an existing independent deployment onto native loopback processes."""

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

import tomlkit
import yaml

from studio.config import read_config
from studio.contracts.gateway.catalog import SERVICES
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.deployment.gateway import render_gateway
from studio.deployment.images import ENTRY_POINTS
from studio.host.deployment.compose_selection import repository_manifest, resolve_files


@dataclass(frozen=True)
class NativeService:
    name: str
    command: tuple[str, ...]
    state: Path
    port: int
    environment: dict[str, str]


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("本机运行文件不能是符号链接")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        os.chmod(path, 0o600)
        stream.write(content)


def interpolate(text, environment):
    def value(match):
        name, operator, default = match.groups()
        selected = environment.get(name)
        if selected:
            return selected
        if operator in {"-", ":-"}:
            return default
        raise ValueError(f"缺少部署变量：{name}")

    return re.sub(r"\$\{([A-Z0-9_]+)(?:(:-|:\?|-|\?)([^}]*))?\}", value, text)


def compose_services(root, config):
    values = read_config(config)
    environment = values.get("fpl_deployment_environment", {})
    base = Path(values["fpl_deployment_compose_file"])
    if not base.is_absolute():
        base = root / base
    base, directory = repository_manifest(root, base)
    directory = directory or base.parent
    units = {}
    for path in resolve_files(base, environment):
        data = yaml.safe_load(interpolate(path.read_text(), environment))
        for name, supplied in data.get("services", {}).items():
            unit = units.setdefault(name, {"mounts": {}, "environment": {}})
            for volume in supplied.get("volumes", []):
                if not isinstance(volume, dict) or volume.get("type") != "bind":
                    raise ValueError("本机开发只接受显式 bind 数据目录")
                source = Path(volume["source"])
                if not source.is_absolute():
                    source = directory / source
                unit["mounts"][volume["target"]] = str(source.resolve())
            unit["environment"].update(supplied.get("environment", {}))
            if "command" in supplied:
                unit["command"] = supplied["command"]
    unknown = units.keys() - ENTRY_POINTS.keys() - {"guacd"}
    if unknown:
        raise ValueError("本机开发不支持未登记服务：" + ", ".join(sorted(unknown)))
    return units


def mapped(value, paths):
    if isinstance(value, dict):
        return {key: mapped(item, paths) for key, item in value.items()}
    if isinstance(value, list):
        return [mapped(item, paths) for item in value]
    if not isinstance(value, str) or not value.startswith("/"):
        return value
    path = Path(value)
    for source in sorted(paths, key=len, reverse=True):
        if path.is_relative_to(source):
            return str(Path(paths[source]) / path.relative_to(source))
    return value


def configuration_copy(
    source, destination, paths, *, identity=False, gateway=False, public_profiles=None
):
    document = tomlkit.parse(source.read_text())
    data = mapped(document.unwrap(), paths)
    if identity:
        data.setdefault("website", {})["port"] = 3000
        data.setdefault("management", {})["local_origin"] = "http://127.0.0.1:3000"
        if public_profiles:
            data.setdefault("remote_web", {})["origin"] = public_profiles["gateway"].origin
            if "management" in public_profiles:
                data["management"]["public_origin"] = public_profiles["management"].origin
    if gateway:
        data["happier"] = {}
    # A projection contains the same secrets; it is never printed or committed.
    private_write(destination, tomlkit.dumps(data))


def development_release(root, directory, service, catalog, schema):
    """Snapshot the Vite entry and API contract, without publishing a production build."""
    entry = service + ".html"
    html = (root / "web" / entry).read_text().replace("%BASE_URL%", "/")
    api_hash = public_contract(schema, service, catalog)
    build = hashlib.sha256(("native-vite\n" + html + api_hash).encode()).hexdigest()[:20]
    release = directory / "web" / service / build
    body = html.encode()
    private_write(release / entry, html)
    private_write(
        release / "build.json",
        json.dumps(
            {
                "version": 1,
                "service": service,
                "build_id": build,
                "api_sha256": api_hash,
                "entry": entry,
                "files": [
                    {"path": entry, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                ],
            }
        ),
    )
    return release, {"build": build, "entry": entry}


def prepare(root, config, directory, caddy, *, public_profiles=None):
    units = compose_services(root, config)
    names = [name for name in ENTRY_POINTS if name in units]
    if public_profiles and not set(public_profiles).issubset(names):
        raise ValueError("公网所需的独立网关未在现有部署中登记")
    addresses = {name: f"127.0.0.1:{19100 + index}" for index, name in enumerate(names)}
    if len(names) != len(set(addresses.values())):
        raise ValueError("本机服务端口重复")
    catalog = RouteCatalog.read(root / "deploy/contracts/ownership.json")
    schema = json.loads((root / "web/src/generated/openapi.json").read_text())
    services, web = [], {}
    all_mounts = {
        target: source for unit in units.values() for target, source in unit["mounts"].items()
    }
    for name in names:
        unit = units[name]
        paths = dict(unit["mounts"])
        state = Path(paths["/state"])
        if not (state / "service.db").is_file():
            raise ValueError(f"{name} 现有数据库缺失；不会初始化或迁移")
        paths.update(
            {
                "/app": str(root),
                "/app/deploy/contracts/openapi.json": str(root / "web/src/generated/openapi.json"),
                "/usr/bin/caddy": str(caddy),
                "/run/fpl-bridge": str(directory / "bridge"),
                "/etc/caddy/Caddyfile": str(directory / f"{name}.Caddyfile"),
            }
        )
        releases = paths.get("/run/fpl/web-releases")
        if releases or (root / "web" / (name + ".html")).is_file():
            release, metadata = development_release(root, directory, name, catalog, schema)
            paths["/app/web"] = str(release)
            web[name] = metadata
        else:
            api_only = directory / "api-only"
            private_write(api_only / ".api-only", "Native API process\n")
            paths["/app/web"] = str(api_only)
        local = directory / name
        if source := paths.get("/run/fpl/config.toml"):
            destination = local / "config.toml"
            configuration_copy(
                Path(source),
                destination,
                paths,
                identity=name == "identity",
                gateway=name == "gateway",
                public_profiles=public_profiles,
            )
            paths["/run/fpl/config.toml"] = str(destination)
        for target in (
            "/run/fpl/native.json",
            "/run/fpl/native-tools.json",
            "/run/fpl/amadeus-native.json",
            "/run/fpl/remote-setup.json",
        ):
            if target in paths:
                destination = local / Path(target).name
                private_write(
                    destination,
                    json.dumps(mapped(json.loads(Path(paths[target]).read_text()), paths)),
                )
                paths[target] = str(destination)
        layout = local / "layout.json"
        private_write(layout, json.dumps({"paths": paths, "addresses": addresses}))
        arguments = list(unit.get("command") or ["serve"])
        if not arguments or arguments[0] != "serve":
            raise ValueError("本机开发仅允许已有服务的 serve 命令")
        arguments.extend(
            [
                "--runtime-layout",
                str(layout),
                "--host",
                "127.0.0.1",
                "--port",
                addresses[name].split(":")[1],
            ]
        )
        if name == "management":
            arguments.append("--api-only")
        if name == "remote":
            arguments.extend(["--guacd-host", "127.0.0.1"])
        env = {key: mapped(value, paths) for key, value in unit["environment"].items()}
        services.append(
            NativeService(
                name,
                ("-m", ENTRY_POINTS[name], *arguments),
                state,
                int(addresses[name].split(":")[1]),
                env,
            )
        )
    native = {}
    for name in (
        "agent-runtime",
        "amadeus",
        "models",
        "integrations",
        "interview",
        "remote",
        "tools",
    ):
        unit = units.get(name)
        if not unit:
            continue
        mounts = unit["mounts"]
        token = mounts.get("/run/fpl/native-ingress")
        if token:
            native[name] = Path(token).read_text().strip()
        else:
            location = next(
                (
                    mounts[key]
                    for key in (
                        "/run/fpl/native.json",
                        "/run/fpl/native-tools.json",
                        "/run/fpl/amadeus-native.json",
                        "/run/fpl/native-options.json",
                        "/run/fpl/remote-setup.json",
                    )
                    if key in mounts
                ),
                None,
            )
            if location:
                data = json.loads(Path(location).read_text())
                native[name] = data.get("ingress", "")
    native = {name: token for name, token in native.items() if token}
    for audience, port, native_port in (("studio", 9001, 29090), ("management", 9002, 29092)):
        name = "gateway" if audience == "studio" else "management"
        public = (public_profiles or {}).get(name)
        token = (
            Path(
                all_mounts["/run/fpl/gateway-token"]
                if audience == "studio"
                else all_mounts["/run/fpl/management-gateway-token"]
            )
            .read_text()
            .strip()
        )
        routing = render_gateway(
            catalog,
            gateway_token=token,
            local_origin="http://127.0.0.1:3000",
            public_origin=public.origin if public else "https://native-development.invalid",
            addresses=addresses,
            local_only=True,
            local_port=port,
            native_port=native_port,
            native_tokens=native
            if audience == "studio"
            else {
                "management": Path(units["management"]["mounts"]["/run/fpl/native-ingress"])
                .read_text()
                .strip()
            },
            control=audience == "studio",
            audience=audience,
            creative_ingress=Path(all_mounts["/run/fpl/creative-bridge-ingress"])
            .read_text()
            .strip()
            if audience == "studio" and "/run/fpl/creative-bridge-ingress" in all_mounts
            else None,
            creative_socket_directory=directory / "bridge",
            public_loopback_port=public.local_port if public else None,
            development_frontend="127.0.0.1:3000" if public else None,
        )
        private_write(directory / f"{name}.Caddyfile", routing)
    routes = [
        {"service": service.id, "roots": list(service.page_roots), **web[service.id]}
        for service in SERVICES
        if service.id in web
    ]
    for route in routes:
        if route["service"] == "portal":
            route["roots"].extend(["/login", "/account"])
    private_write(directory / "web.json", json.dumps(routes))
    return services
