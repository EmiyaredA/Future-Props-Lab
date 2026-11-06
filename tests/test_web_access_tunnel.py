import asyncio
from contextlib import suppress
from types import SimpleNamespace

import pytest

from studio.assembly.website import public_access as runtime


@pytest.mark.asyncio
async def test_failed_public_probe_preserves_established_ssh_tunnel(monkeypatch, tmp_path):
    settings = SimpleNamespace(
        fpl_happier_origin="",
        fpl_remote_web_origin="https://studio.example.test",
        fpl_remote_web_port=28081,
        fpl_remote_web_ssh_host="gateway.example.test",
        fpl_remote_web_ssh_port=22,
        fpl_remote_web_ssh_user="tunnel",
        fpl_remote_web_remote_port=28080,
        fpl_remote_web_identity_id="a" * 32,
        fpl_remote_web_known_hosts_id="b" * 32,
    )
    access = runtime.WebAccess(None, settings, tmp_path, tmp_path, None)
    access.store.credentials.mkdir(parents=True)
    for identity, kind in [("a" * 32, "identity"), ("b" * 32, "known_hosts")]:
        access.store.credential_path(identity, kind).touch()
    access.public_enabled = True
    recovered = asyncio.Event()
    children = []

    class Child:
        returncode = None
        waits = 0

        async def wait(self):
            self.waits += 1
            if self.returncode is not None:
                return self.returncode
            if self.waits <= 2:
                raise TimeoutError
            await asyncio.Future()

        def terminate(self):
            self.returncode = -15

    async def start_ssh(*_args, **_kwargs):
        child = Child()
        children.append(child)
        return child

    probes = 0

    async def check_public():
        nonlocal probes
        probes += 1
        if probes == 2:
            raise runtime.AccessError("gateway probe failed")
        if probes == 3:
            recovered.set()

    monkeypatch.setattr(runtime.asyncio, "create_subprocess_exec", start_ssh)
    monkeypatch.setattr(access, "check_public", check_public)
    task = asyncio.create_task(access.follow_tunnel())
    try:
        await asyncio.wait_for(recovered.wait(), 5)
        assert len(children) == 1
        assert children[0].returncode is None
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
