"""Rehearse Amadeus graph transfer and interrupted-run recovery using owned state."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_amadeus_history import verify_relationships
from scripts.website.migration_transfer import pages, project_datasets, transfer
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from tests.test_tools_navigation_migration import available_ports, listener

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from db.migrations import apply_migrations
from studio.apps.amadeus.storage.migration_history import DATASETS, LINKS
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.storage.models.accounts import User
from studio.assembly.independent.amadeus.application import create_app
from studio.assembly.independent.amadeus.maintenance import PREFIX, RELATIONSHIPS
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply


def seed_legacy(path, owner, other):
    apply_migrations(path)
    ids = SimpleNamespace(
        conversation=str(uuid4()),
        first="ffffffff-ffff-4fff-bfff-ffffffffffff",
        continuation="00000000-0000-4000-8000-000000000001",
        response=str(uuid4()),
        action=str(uuid4()),
    )
    engine = create_engine(f"sqlite:///{path}")
    try:
        with Session(engine) as session:
            for account, name in ((owner, "owner"), (other, "other")):
                session.add(
                    User(
                        id=str(account),
                        username=name,
                        username_normalized=name,
                        password_hash="fixture",
                    )
                )
            session.add(
                AmadeusConversation(
                    id=ids.conversation,
                    owner_user_id=str(owner),
                    user_id=str(owner),
                    title="保留对话",
                    revision=6,
                )
            )
            session.flush()
            owned = {"owner_user_id": str(owner), "user_id": str(owner)}
            dialogue = {"conversation_id": ids.conversation}
            session.add(
                AmadeusRun(
                    id=ids.first,
                    **owned,
                    **dialogue,
                    model_id="code-agent",
                    status="completed",
                    response_message_id=ids.response,
                    last_event_sequence=1,
                )
            )
            session.flush()
            session.add(
                AmadeusRun(
                    id=ids.continuation,
                    **owned,
                    **dialogue,
                    model_id="code-agent",
                    status="running",
                    source_run_id=ids.first,
                    partial_text="旧运行尚未发出的部分回复",
                    active_owner_key=str(owner),
                    last_event_sequence=1,
                )
            )
            session.flush()
            session.add_all(
                [
                    AmadeusMessage(
                        id=ids.response,
                        **dialogue,
                        owner_user_id=str(owner),
                        role="assistant",
                        content="原回答",
                        run_id=ids.first,
                    ),
                    AmadeusAction(
                        id=ids.action,
                        **owned,
                        **dialogue,
                        run_id=ids.continuation,
                        tool_name="tool_api:fixture",
                        arguments_json={"name": "synthetic"},
                        arguments_sha256="a" * 64,
                        status="running",
                    ),
                    AmadeusQuestion(
                        **owned,
                        **dialogue,
                        run_id=ids.first,
                        tool_call_id="original-call",
                        prompt="原确认问题",
                        options_json=["yes"],
                        status="answered",
                        answer_json={"answer": "yes"},
                    ),
                ]
            )
            for run, label in ((ids.first, "previous"), (ids.continuation, "current")):
                session.add(
                    AmadeusRunEvent(
                        run_id=run,
                        owner_user_id=str(owner),
                        sequence=1,
                        kind="text_delta",
                        payload_json={"text": label},
                        idempotency_key="original-event",
                    )
                )
            session.commit()
    finally:
        engine.dispose()
    return ids


def test_transfer_amadeus_graph_and_preserve_unknown_execution(tmp_path):
    owner, other = uuid4(), uuid4()
    old = tmp_path / "legacy.sqlite"
    ids = seed_legacy(old, owner, other)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="d" * 40,
        source_database_sha256=digest(old),
        owner_ids=(owner, other),
        token="isolated-amadeus-migration-history-token",
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps({**plan.model_dump(mode="json"), "token": plan.token.get_secret_value()})
    )
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    state = tmp_path / "amadeus"
    apply(state / "service.db", "amadeus", MIGRATIONS)
    conversations, runs, messages, actions, questions, events, links = project_datasets(
        PREFIX, (*DATASETS, LINKS)
    )
    old_port, new_port = available_ports()

    def start(client, port, command, *args):
        return listener(
            client,
            port,
            command,
            plan_file,
            *args,
            module="studio.assembly.independent.amadeus.cli",
            prefix=conversations.prefix,
        )

    def open_target(client):
        return start(client, new_port, "migration-import", "--state-root", state)

    def upload(client, target, dataset, batch):
        return client.post(
            target + dataset.prefix + "/batches",
            headers={**headers, "X-Fpl-Migration-SHA256": batch.digest},
            json=batch.model_dump(mode="json"),
        )

    with (
        httpx.Client(timeout=25, trust_env=False) as client,
        start(client, old_port, "migration-export", "--legacy-db", old) as source,
    ):
        with open_target(client) as target:
            assert transfer(client, plan, source, target, conversations)["record_count"] == 1
            first = next(pages(client, source, headers, plan, owner, runs)).batch
            assert first.records[0].id == ids.continuation
            durable = upload(client, target, runs, first)
            durable.raise_for_status()
            early = durable.json()

        with open_target(client) as target:
            assert upload(client, target, runs, first).json() == early
            assert transfer(client, plan, source, target, runs)["record_count"] == 2
            incomplete = client.get(target + RELATIONSHIPS, headers=headers)
            assert incomplete.status_code == 409
            assert incomplete.json()["code"] == "migration_amadeus_run_relationship_invalid"
            for dataset, count in ((messages, 1), (actions, 1), (questions, 1), (events, 2)):
                assert transfer(client, plan, source, target, dataset)["record_count"] == count
            evidence = transfer(client, plan, source, target, links)
            assert evidence["record_count"] == 1
            original = next(pages(client, target, headers, plan, owner, links)).batch
            (link,) = original.records
            assert (link.id, link.source_run_id) == (ids.continuation, ids.first)
            cycle = original.model_copy(
                update={
                    "batch_id": uuid4(),
                    "records": (
                        link.model_copy(
                            update={"id": ids.first, "source_run_id": ids.continuation}
                        ),
                    ),
                }
            )
            denied = upload(client, target, links, cycle)
            assert denied.status_code == 409
            assert denied.json()["code"] == "migration_amadeus_run_graph_invalid"
            foreign = original.model_copy(update={"owner_id": other, "batch_id": uuid4()})
            assert upload(client, target, links, foreign).status_code == 409
            assert transfer(client, plan, source, target, links) == evidence
            assert verify_relationships(client, plan, source, target)["record_count"] == 2

    async def first_start():
        app = create_app(
            state_root=state,
            catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
            public_key=Ed25519PrivateKey.generate().public_key(),
            credential="a" * 48,
        )
        async with app.router.lifespan_context(app):
            async with app.state.database.sessions(info={"owner_user_id": str(owner)}) as session:
                run = await session.get(AmadeusRun, ids.continuation)
                assert run.status == "interrupted" and run.active_owner_key is None
                assert run.source_run_id == ids.first
                action = await session.get(AmadeusAction, ids.action)
                assert action.status == "unknown"
                partial = await session.get(AmadeusMessage, run.response_message_id)
                assert partial.content == run.partial_text and partial.status == "interrupted"
                events = list(
                    await session.scalars(
                        select(AmadeusRunEvent).where(AmadeusRunEvent.run_id == run.id)
                    )
                )
                assert [(event.sequence, event.payload_json) for event in events] == [
                    (1, {"text": "current"})
                ]
            async with app.state.database.sessions(info={"owner_user_id": str(other)}) as session:
                assert await session.get(AmadeusRun, ids.continuation) is None

    asyncio.run(first_start())
