"""Workbench version observation does not require HTTP, SQL or a live executor."""

from contextlib import aclosing

from studio.apps.agent_workbench.use_cases.observe_turns import ObserveTurns


class Versions:
    def __init__(self):
        self.current = ((False, (("turn", 1),)), False)
        self.owners = []

    async def read(self, owner, chat_id):
        self.owners.append((owner, chat_id))
        return self.current


async def test_subscription_reloads_only_changed_versions_and_rechecks_authority():
    versions = Versions()
    active, connected, checks = True, True, 0

    async def authorize():
        nonlocal checks
        checks += 1
        return active

    async def disconnected():
        return not connected

    async def pause():
        pass

    def subscribe():
        return ObserveTurns(versions, authorize=authorize, disconnected=disconnected, pause=pause)

    async with aclosing(subscribe().stream("alice", "chat")) as events:
        first = await anext(events)
        assert first.kind == "change" and first.version == versions.current
        assert (await anext(events)).kind == "heartbeat"
        versions.current = ((False, (("turn", 2),)), True)
        assert (await anext(events)).version == versions.current
        active = False
        assert (await anext(events)).kind == "auth_expired"
        assert checks == 4 and versions.owners == [("alice", "chat")] * 3

    # Reconnect starts from the current persisted snapshot, not a process-global cursor.
    active = True
    async with aclosing(subscribe().stream("alice", "chat")) as events:
        assert (await anext(events)).version == versions.current
        connected = False
        assert (await anext(events)).kind == "auth_expired"
