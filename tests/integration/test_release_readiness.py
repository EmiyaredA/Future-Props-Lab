import time

import httpx
import pytest
from scripts.website.release_readiness import wait_for_release_pages


def test_release_probe_survives_a_proxy_reload():
    seen = []

    def during_reload(request):
        seen.append(request.url.path)
        if seen == ["/apps"]:
            raise httpx.RemoteProtocolError("Proxy closed the connection", request=request)
        build = "portal" if request.url.path == "/apps" else "management"
        return httpx.Response(
            200, headers={"Content-Type": "text/html", "X-Application-Build": build}
        )

    with httpx.Client(transport=httpx.MockTransport(during_reload)) as client:
        wait_for_release_pages(
            client,
            {"https://studio.test/apps": "portal", "https://studio.test/management": "management"},
            deadline=time.monotonic() + 5,
        )
    assert seen == ["/apps", "/management", "/apps"]


def test_release_probe_rejects_a_stale_application_build():
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, headers={"Content-Type": "text/html", "X-Application-Build": "old"}
            )
        )
    ) as client:
        with pytest.raises(ValueError, match="unexpected build"):
            wait_for_release_pages(
                client, {"https://studio.test/apps": "new"}, deadline=time.monotonic() + 5
            )
