"""Generate listener-specific routing from the exhaustive public operation catalog."""

import json
import re
from collections import defaultdict
from urllib.parse import urlsplit

from fpl_runtime.catalog import SERVICES


def quoted(value):
    return json.dumps(value, ensure_ascii=True)


def service_upstream(service):
    host = "127.0.0.1" if service == "gateway" else service
    return host + ":8080"


def render_gateway(
    catalog,
    *,
    gateway_token,
    local_origin,
    public_origin,
    native_tokens=None,
    native_port=29090,
    control=False,
):
    origins = {"local": urlsplit(local_origin), "public": urlsplit(public_origin)}
    if (
        origins["local"].scheme != "http"
        or origins["local"].hostname != "127.0.0.1"
        or origins["public"].scheme != "https"
        or any(
            origin.path or origin.query or origin.fragment or origin.username or not origin.netloc
            for origin in origins.values()
        )
    ):
        raise ValueError("网关来源必须是精确的本机 HTTP 与公网 HTTPS 来源")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", gateway_token):
        raise ValueError("网关凭据格式无效")
    groups = defaultdict(list)
    for operation in catalog.operations:
        groups[(operation.service, operation.method)].append(operation)
    result = ["{", "  admin off", "  auto_https off", "}"]
    for ingress, port in (("local", 9000), ("public", 28081)):
        origin = origins[ingress]
        lines = [
            f"http://:{port} {{",
            "  route {",
            f"    @bad_host expression {{http.request.hostport}} != {quoted(origin.netloc)}",
            "    respond @bad_host 403",
            "    @bad_origin {",
            "      header Origin *",
            f"      not header Origin {quoted(origin.geturl())}",
            "    }",
            "    respond @bad_origin 403",
            "    request_header -X-Fpl-*",
            "    request_header -X-Forwarded-*",
            "    request_header -Forwarded",
            "    @probe path /health /ready",
            "    handle @probe {",
            '      header Content-Type "application/json"',
            '      respond "{\\"status\\":\\"ok\\",\\"service\\":\\"gateway\\"}" 200',
            "    }",
            "    @internal path /_internal /_internal/* /_native /_native/*",
            "    respond @internal 404",
        ]
        if control:
            start = lines.index("    @probe path /health /ready")
            stop = lines.index("    @internal path /_internal /_internal/* /_native /_native/*")
            lines[start:stop] = [
                "    @probe path /health /ready /build.json",
                "    handle @probe {",
                "      reverse_proxy 127.0.0.1:8080 {",
                "        header_up -Cookie",
                "        header_up -Authorization",
                "      }",
                "    }",
            ]
        lines.extend(
            [
                "    @old_agents path /apps/agent-workbench /apps/agent-workbench/*",
                "    handle @old_agents {",
                "      route {",
                "        uri strip_prefix /apps/agent-workbench",
                "        redir * /agents{uri} 308",
                "      }",
                "    }",
            ]
        )
        for index, ((service, method), operations) in enumerate(sorted(groups.items())):
            name = f"{ingress}_api_{index}"
            paths = "|".join(op.pattern().pattern[1:-1] for op in operations)
            lines.extend(
                [
                    f"    @{name} {{",
                    f"      method {method}",
                    f"      path_regexp {name} ^(?:{paths})$",
                    "    }",
                    f"    handle @{name} {{",
                    "      route {",
                    "        header >Cache-Control no-store",
                    f"        request_header X-Fpl-Gateway {quoted(gateway_token)}",
                    f"        request_header X-Fpl-Ingress {ingress}",
                    "        request_header X-Fpl-Client-Ip {remote_host}",
                ]
            )
            if service != "identity":
                lines.extend(
                    [
                        f"        request_header X-Fpl-Target-Service {service}",
                        "        request_header X-Fpl-Request-Method {method}",
                        "        request_header X-Fpl-Request-Uri {uri}",
                        "        forward_auth identity:8080 {",
                        "          uri /_internal/v1/authorize",
                        "          copy_headers X-Fpl-Context",
                        "        }",
                    ]
                )
            lines.extend(
                [
                    f"        reverse_proxy {service_upstream(service)} {{",
                    "          flush_interval -1",
                ]
            )
            if service != "identity":
                lines.extend(
                    [
                        "          header_up -Cookie",
                        "          header_up -Authorization",
                        "          header_up -X-Fpl-Gateway",
                        "          header_up -X-Fpl-Target-Service",
                        "          header_up -X-Fpl-Request-*",
                        "          header_up -X-Fpl-Ingress",
                        "          header_up -X-Fpl-Client-Ip",
                    ]
                )
            lines.extend(["        }", "      }", "    }"])
        lines.extend(
            [
                "    @unknown_api path /v1 /v1/*",
                "    handle @unknown_api {",
                "      header >Cache-Control no-store",
                "      respond 404",
                "    }",
            ]
        )
        for service in sorted(SERVICES, key=lambda unit: unit.id == "portal"):
            paths = [f"/_apps/{service.id}/*"]
            for root in service.page_roots:
                paths.append(root)
                if root not in {"/", "/apps"} and not root.endswith(".html"):
                    paths.append(root + "/*")
            if not service.page_roots:
                continue
            name = f"{ingress}_page_{service.id}"
            lines.extend(
                [
                    f"    @{name} path " + " ".join(paths),
                    f"    handle @{name} {{",
                    f"      reverse_proxy {service.id}:8080 {{",
                    "        header_up -Cookie",
                    "        header_up -Authorization",
                    "      }",
                    "    }",
                ]
            )
        lines.extend(["    respond 404", "  }", "}"])
        result.extend(lines)
    if native_tokens:
        result.extend(
            [
                "http://:29090 {",
                "  route {",
                f'    @host expression {{http.request.hostport}} != "127.0.0.1:{native_port}"',
                "    respond @host 403",
                "    @browser header Origin *",
                "    respond @browser 403",
                "    request_header -X-Fpl-*",
                "    request_header -Cookie",
                "    request_header -X-Forwarded-*",
                "    request_header -Forwarded",
            ]
        )
        for service, token in sorted(native_tokens.items()):
            if service != "agents" or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
                raise ValueError("原生通道服务或凭据无效")
            result.extend(
                [
                    f"    handle /{service}/_native/* {{",
                    "      route {",
                    f"        uri strip_prefix /{service}",
                    f"        request_header X-Fpl-Native-Ingress {quoted(token)}",
                    f"        reverse_proxy {service_upstream(service)} {{",
                    "          flush_interval -1",
                    "        }",
                    "      }",
                    "    }",
                ]
            )
        result.extend(["    respond 404", "  }", "}"])
    return "\n".join(result) + "\n"
