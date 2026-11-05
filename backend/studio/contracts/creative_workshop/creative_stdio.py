"""Bind an account's stdio setup to an owned installation and the keyed input digest."""

import re

PUBLIC_STDIO = "/v1/creative-workshop/installations/{installation_id}/stdio"
PRIVATE_STDIO = "/_internal/v1/creative-integrations/stdio/"
_ID = r"[A-Za-z0-9_-]{1,100}"
_SOURCE = re.compile(PUBLIC_STDIO.replace("{installation_id}", f"({_ID})"))
_TARGET = re.compile(PRIVATE_STDIO + f"({_ID})/[a-f0-9]{{64}}")


def stdio_source(method, path):
    return method == "POST" and _SOURCE.fullmatch(path)


def stdio_target(method, path):
    return method == "POST" and _TARGET.fullmatch(path)


def stdio_grant(grant):
    if (
        grant.caller != "creative"
        or grant.purpose != "creative.install-stdio.write"
        or grant.target_service != "integrations"
    ):
        return False
    source = stdio_source(grant.source_method, grant.source_path)
    target = stdio_target(grant.target_method, grant.target_path)
    return bool(source and target and source[1] == target[1])
