"""Verify browser entry pages during a proxy reload."""

import time

import httpx


def wait_for_release_pages(client: httpx.Client, pages: dict[str, str], *, deadline: float) -> None:
    """Retry transient read failures. A responding page must match its pinned build."""
    remaining_pages = dict(pages)
    while remaining_pages and time.monotonic() < deadline:
        for url, build in tuple(remaining_pages.items()):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                response = client.get(
                    url,
                    headers={"Accept": "text/html"},
                    follow_redirects=True,
                    timeout=min(remaining, 4),
                )
            except httpx.TransportError:
                continue
            if response.status_code in (502, 503, 504):
                continue
            response.raise_for_status()
            if (
                not response.headers.get("content-type", "").startswith("text/html")
                or response.headers.get("x-application-build") != build
            ):
                raise ValueError(f"Release page returned an unexpected build or media type: {url}")
            del remaining_pages[url]
        if remaining_pages:
            time.sleep(min(1, max(0, deadline - time.monotonic())))
    if remaining_pages:
        raise TimeoutError("Release pages did not become ready: " + ", ".join(remaining_pages))
