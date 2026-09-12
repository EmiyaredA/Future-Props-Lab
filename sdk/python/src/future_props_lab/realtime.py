"""Session-authenticated PCM protocol; audio device ownership stays with the caller."""

import base64
import json

from .encoding import encode
from .streams import StreamEvent


def _connection_args(client):
    url = client.base_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
    request = client._http.build_request("GET", client.base_url + "/v1/model-test/realtime")
    cookie = request.headers.get("cookie")
    if not cookie:
        raise ValueError("Login before opening realtime")
    return url + "/v1/model-test/realtime", {"Cookie": cookie}


class RealtimeConnection:
    def __init__(self, client):
        self.client = client
        self.muted = False

    def __enter__(self):
        from websockets.sync.client import connect

        url, headers = _connection_args(self.client)
        self.socket = connect(url, additional_headers=headers, origin=self.client.origin)
        return self

    def __exit__(self, *_):
        self.socket.close()

    def send(self, message):
        self.socket.send(json.dumps(encode(message)))

    def start(self, *, model_id, voice, instructions, **options):
        self.send(
            {
                **options,
                "type": "start",
                "model_id": model_id,
                "voice": voice,
                "instructions": instructions,
            }
        )

    def audio(self, pcm: bytes):
        if not self.muted:
            self.send({"type": "audio", "data": base64.b64encode(pcm).decode()})

    def interrupt(self):
        self.send({"type": "interrupt"})

    def mute(self, muted: bool):
        self.muted = bool(muted)

    def stop(self):
        self.send({"type": "stop"})

    def commit_input(self, *, turn_id: str = ""):
        self.send({"type": "commit_input", "turn_id": turn_id})

    def __iter__(self):
        for message in self.socket:
            yield StreamEvent.model_validate(json.loads(message))


class AsyncRealtimeConnection:
    def __init__(self, client):
        self.client = client
        self.muted = False

    async def __aenter__(self):
        from websockets.asyncio.client import connect

        url, headers = _connection_args(self.client)
        self.socket = await connect(url, additional_headers=headers, origin=self.client.origin)
        return self

    async def __aexit__(self, *_):
        await self.socket.close()

    async def send(self, message):
        await self.socket.send(json.dumps(encode(message)))

    async def start(self, *, model_id, voice, instructions, **options):
        await self.send(
            {
                **options,
                "type": "start",
                "model_id": model_id,
                "voice": voice,
                "instructions": instructions,
            }
        )

    async def audio(self, pcm: bytes):
        if not self.muted:
            await self.send({"type": "audio", "data": base64.b64encode(pcm).decode()})

    async def interrupt(self):
        await self.send({"type": "interrupt"})

    async def mute(self, muted: bool):
        self.muted = bool(muted)

    async def stop(self):
        await self.send({"type": "stop"})

    async def commit_input(self, *, turn_id: str = ""):
        await self.send({"type": "commit_input", "turn_id": turn_id})

    async def __aiter__(self):
        async for message in self.socket:
            yield StreamEvent.model_validate(json.loads(message))
