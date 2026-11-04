"""Recognize authentication rejection when guacd reports a generic connect failure."""

import asyncio
from contextlib import suppress

from cryptography.hazmat.decrepit.ciphers.algorithms import TripleDES
from cryptography.hazmat.primitives.ciphers import Cipher, modes

# Standard VNC authentication reverses the bits of each byte of the DES key.
REVERSED_BITS = bytes(int(f"{value:08b}"[::-1], 2) for value in range(256))


async def password_rejected(settings, password):
    # The Docker host alias and native guacd both refer to this same Mac.
    if settings.fpl_cloud_control_vnc_host not in {"127.0.0.1", "host.docker.internal"}:
        return False
    writer = None
    try:
        async with asyncio.timeout(2):
            reader, writer = await asyncio.open_connection(
                "127.0.0.1", settings.fpl_cloud_control_vnc_port
            )
            if not (await reader.readexactly(12)).startswith(b"RFB 003."):
                return False
            writer.write(b"RFB 003.008\n")
            await writer.drain()
            count = (await reader.readexactly(1))[0]
            if not count or 2 not in await reader.readexactly(count):
                return False
            writer.write(b"\x02")
            await writer.drain()
            challenge = await reader.readexactly(16)
            key = password.encode()[:8].ljust(8, b"\x00").translate(REVERSED_BITS)
            encryptor = Cipher(TripleDES(key * 3), modes.ECB()).encryptor()
            writer.write(encryptor.update(challenge) + encryptor.finalize())
            await writer.drain()
            return await reader.readexactly(4) == b"\x00\x00\x00\x01"
    except (OSError, TimeoutError, EOFError, ValueError):
        return False
    finally:
        if writer:
            writer.close()
            with suppress(OSError, TimeoutError):
                async with asyncio.timeout(1):
                    await writer.wait_closed()
