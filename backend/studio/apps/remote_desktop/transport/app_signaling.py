"""Browser signaling and the lifetime of a single host window session."""

import asyncio
import json
import time
from contextlib import suppress
from functools import partial

from starlette.websockets import WebSocketDisconnect

MAX_MESSAGE = 128 * 1024
HOST_MESSAGES = {"windows", "waiting", "answer", "error", "paused"}


class SignalingError(ValueError):
    pass


async def read_message(socket):
    event = await socket.receive()
    if event["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(event.get("code", 1000))
    raw = event.get("text")
    if not isinstance(raw, str) or len(raw.encode()) > MAX_MESSAGE:
        raise SignalingError
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SignalingError
    return data


async def send_host(process, data):
    process.stdin.write(json.dumps(data, separators=(",", ":")).encode() + b"\n")
    await asyncio.wait_for(process.stdin.drain(), 3)


async def bridge(socket, process, *, access, ice_servers):
    async def receive_host():
        line = await process.stdout.readline()
        return json.loads(line) if line else None

    await relay_signaling(
        socket,
        send=partial(send_host, process),
        receive=receive_host,
        access=access,
        ice_servers=ice_servers,
    )


async def relay_signaling(socket, *, send, receive, access, ice_servers):
    last_input = time.monotonic()
    await send({"type": "configure", "ice_servers": ice_servers})

    async def to_host():
        offered = False
        while True:
            message = await read_message(socket)
            if (
                message.get("type") == "offer"
                and not offered
                and isinstance(message.get("sdp"), str)
                and message["sdp"].startswith("v=0")
            ):
                offered = True
                await send({"type": "offer", "sdp": message["sdp"]})
            elif (
                message.get("type") == "select"
                and offered
                and type(message.get("window")) is int
                and 0 < message["window"] <= 2**32 - 1
            ):
                await send({"type": "select", "window": message["window"]})
            else:
                raise SignalingError

    async def to_browser():
        nonlocal last_input
        while (message := await receive()) is not None:
            if message["type"] == "activity":
                last_input = time.monotonic()
            elif message["type"] in HOST_MESSAGES:
                await socket.send_json(message)
                if message["type"] == "error":
                    return
        await socket.send_json({"type": "error", "message": "Mac 远程应用辅助程序已断开"})

    async def monitor():
        while True:
            try:
                minutes = await asyncio.wait_for(access(), 3)
            except TimeoutError:
                return 4411, "无法复核远程应用授权"
            if minutes is None:
                return 4403, "应用授权已失效"
            if time.monotonic() - last_input >= minutes * 60:
                return 4408, "远程应用已自动锁定"
            await asyncio.sleep(2)

    tasks = [asyncio.create_task(run()) for run in (to_host, to_browser, monitor)]
    close = (1000, "")
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            result = task.result()
            if result:
                close = result
    except (WebSocketDisconnect, BrokenPipeError, ConnectionResetError):
        pass
    except ValueError:
        close = (4400, "远程应用信令格式无效")
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(WebSocketDisconnect, RuntimeError, OSError):
            await socket.close(*close)
