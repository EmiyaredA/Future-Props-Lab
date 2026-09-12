"""Run with the independently installed SDK interpreter, outside the backend environment."""

import asyncio
import importlib.util

import httpx
from future_props_lab import AsyncClient, Client, models


def main():
    if importlib.util.find_spec("app") is not None:
        raise SystemExit("Use an isolated environment without the backend application")
    seen = []

    def respond(request):
        seen.append((request.method, request.url.path))
        return httpx.Response(204)

    with Client(base_url="http://sdk.invalid", transport=httpx.MockTransport(respond)) as client:
        client.presentation.list_projects()
        client.files.crop_file_image(
            asset_id="image", body={"x": 0, "y": 0, "width": 1, "height": 1}
        )

    async def asynchronous():
        async with AsyncClient(
            base_url="http://sdk.invalid", transport=httpx.MockTransport(respond)
        ) as client:
            await client.presentation.list_projects()

    asyncio.run(asynchronous())
    assert seen == [
        ("GET", "/v1/presentation-workshop/projects"),
        ("POST", "/v1/files/image/crop"),
        ("GET", "/v1/presentation-workshop/projects"),
    ]
    assert "hidden-password" not in repr(
        models.LoginIn(username="test", password="hidden-password")
    )
    print("Independent SDK installation, sync/async HTTP calls and credential-safe models passed")


if __name__ == "__main__":
    main()
