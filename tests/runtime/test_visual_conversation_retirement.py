"""Exercise retirement through the real migration runners on isolated databases."""

import sqlite3

import pytest

from db.migrations import runner
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSETS
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODELS
from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS as VISUAL
from studio.runtime.database.migrations import apply

NOW = "2026-11-09 00:00:00"
REGISTRIES = {"website": runner.MIGRATIONS, "visual": VISUAL, "models": MODELS, "assets": ASSETS}


def migrate(path, owner, monkeypatch, *, old=False):
    registry = REGISTRIES[owner]
    if old:
        registry = registry[:-1]
    if owner == "website":
        with monkeypatch.context() as patch:
            patch.setattr(runner, "MIGRATIONS", registry)
            patch.setattr(runner, "LATEST_MIGRATION_ID", registry[-1].migration_id)
            runner.apply_migrations(path)
    else:
        apply(path, owner, registry)


def insert(db, table, **fields):
    fields.update(
        {
            column: NOW
            for _, column, _, _, _, _ in db.execute(f"PRAGMA table_info({table})")
            if column in {"created_at", "updated_at"}
        }
    )
    db.execute(
        f"INSERT INTO {table} ({', '.join(fields)}) VALUES ({','.join('?' for _ in fields)})",
        tuple(fields.values()),
    )


def log_history(db, owner):
    for index, source in enumerate(
        ("visual_workshop_assistant", "visual_workshop_generation", "amadeus")
    ):
        insert(
            db,
            "llm_call_logs",
            id=f"{owner}-{index}",
            owner_user_id=owner,
            call_source=source,
            provider_kind="openai",
            model="fixture",
            trace_id=f"trace-{index}",
            request_payload="{}",
            response_payload='{"usage":{"input_tokens":23}}',
            status="success",
            total_tokens=23,
            latency_ms=0,
        )


def transcript(db, owner, *, website):
    project = f"project-{owner}"
    insert(
        db,
        "visual_workshop_projects",
        id=project,
        owner_user_id=owner,
        title=project,
        kind="canvas",
        status="draft",
        revision=3,
        is_official=False,
    )
    insert(
        db,
        "visual_canvas_documents",
        project_id=project,
        nodes='[{"id":"result","kind":"image","title":"Keep"}]',
        edges="[]",
        categories="[]",
        revision=4,
    )
    insert(
        db,
        "visual_assistant_conversations",
        id=owner,
        owner_user_id=owner,
        project_id=project,
        title="Retired",
        revision=7,
    )
    insert(
        db,
        "visual_assistant_messages",
        id=owner,
        conversation_id=owner,
        position=0,
        turn_id="old-turn",
        role="assistant",
        content="Old message",
        content_parts="[]",
        model_slug="",
        status="completed",
    )
    if website:
        insert(
            db,
            "visual_assets",
            id=owner,
            owner_user_id=owner,
            project_id=project,
            original_filename="shared.png",
            display_name="shared.png",
            storage_key=owner,
            storage_version=1,
            media_kind="image",
            mime_type="image/png",
            byte_size=4,
            revision=0,
        )
    insert(
        db,
        "visual_assistant_message_assets",
        id=owner,
        message_id=owner,
        asset_id=owner,
        position=0,
    )
    insert(
        db,
        "visual_generation_tasks",
        id=owner,
        project_id=project,
        owner_user_id=owner,
        provider_kind="senseaudio_image",
        generation_kind="image",
        provider_name="fixture",
        model_slug="image-model",
        request_payload="{}",
        status="completed",
        progress=100,
        result_asset_id=owner,
        revision=3,
    )
    insert(
        db,
        "visual_assistant_actions",
        id=owner,
        message_id=owner,
        action_id="old-action",
        run_id="old-run",
        position=0,
        tool_name="generate_image",
        effect="external",
        status="completed",
        display_payload="{}",
        result_payload="{}",
        generation_task_id=owner,
    )


def asset_pins(db, owner):
    insert(
        db,
        "visual_assets",
        id=owner,
        owner_user_id=owner,
        original_filename="shared.png",
        display_name="shared.png",
        storage_key=owner,
        storage_version=1,
        media_kind="image",
        mime_type="image/png",
        byte_size=4,
        revision=0,
    )
    for service, kind in (
        ("visual", "conversation"),
        ("visual", "canvas"),
        ("amadeus", "conversation"),
    ):
        ref = f"{owner}-{service}-{kind}"
        insert(
            db,
            "asset_reference_sets",
            id=ref,
            owner_user_id=owner,
            service_id=service,
            resource_kind=kind,
            resource_id=owner,
            resource_revision=1,
            revision=1,
        )
        insert(
            db, "asset_reference_pins", reference_set_id=ref, asset_id=owner, owner_user_id=owner
        )
        insert(
            db,
            "asset_reference_intents",
            id=ref,
            owner_user_id=owner,
            service_id=service,
            request_id=ref,
            reference_set_id=ref,
            expected_resource_revision=0,
            payload_sha256="0" * 64,
            state="committed",
            prepared_result="{}",
        )


def model_run(db, owner):
    for lease in (owner, f"generation-{owner}"):
        insert(
            db,
            "runtime_admissions",
            id=lease,
            owner_user_id=owner,
            platform_role="user",
            realtime_voice=False,
            weight=1,
            task_ids="[]",
            waiting=False,
            released_at=NOW,
        )
    insert(
        db,
        "visual_assistant_model_runs",
        owner_user_id=owner,
        run_id="old-run",
        project_id="project",
        conversation_id=owner,
        start_digest="0" * 64,
        model_id="model",
        model_signature="0" * 64,
        model_plan="{}",
        request_summary="{}",
        trace_id="trace",
        lease_id=owner,
        state="settled",
        round_index=1,
        round_events="[]",
        usage="{}",
    )


GUARDS = {
    "website": [
        (
            "UPDATE visual_assistant_messages SET status='pending'",
            "UPDATE visual_assistant_messages SET status='completed'",
        ),
        (
            "UPDATE visual_assistant_actions SET status='waiting_approval'",
            "UPDATE visual_assistant_actions SET status='cancelled'",
        ),
    ],
    "visual": [
        (
            "UPDATE visual_canvas_reference_mutations SET state='commit' WHERE request_id='old'",
            "UPDATE visual_canvas_reference_mutations SET state='committed' WHERE request_id='old'",
        ),
        (
            """INSERT INTO visual_assistant_dispatches
              (run_id,owner_user_id,project_id,conversation_id,trace_id,phase,updated_at)
              VALUES ('unsettled','alice','project-alice','alice','trace','settling',
                      CURRENT_TIMESTAMP)""",
            "DELETE FROM visual_assistant_dispatches WHERE run_id='unsettled'",
        ),
    ],
    "models": [
        (
            "UPDATE visual_assistant_model_runs SET state='open'",
            "UPDATE visual_assistant_model_runs SET state='settled'",
        ),
        (
            "UPDATE runtime_admissions SET released_at=NULL WHERE id='alice'",
            "UPDATE runtime_admissions SET released_at=CURRENT_TIMESTAMP WHERE id='alice'",
        ),
    ],
    "assets": [
        (
            "UPDATE asset_reference_intents SET state='prepared' "
            "WHERE id='alice-visual-conversation'",
            "UPDATE asset_reference_intents SET state='aborted' "
            "WHERE id='alice-visual-conversation'",
        ),
    ],
}


@pytest.mark.parametrize("service", REGISTRIES)
def test_fresh_install_retires_conversation_schema(tmp_path, monkeypatch, service):
    path = tmp_path / "fresh.db"
    migrate(path, service, monkeypatch)
    with runner.connect_database(path) as db:
        assert not db.execute(
            "SELECT name FROM sqlite_master WHERE name LIKE 'visual_assistant_%'"
        ).fetchall()
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("service", REGISTRIES)
def test_retirement_aborts_until_settled_and_only_removes_old_dialogue(
    tmp_path, monkeypatch, service
):
    path = tmp_path / "upgrade.db"
    migrate(path, service, monkeypatch, old=True)
    with runner.connect_database(path) as db:
        for owner in ("alice", "bob"):
            if service in {"website", "visual"}:
                transcript(db, owner, website=service == "website")
            if service in {"website", "models"}:
                log_history(db, owner)
            if service == "models":
                model_run(db, owner)
            if service == "assets":
                asset_pins(db, owner)
        if service == "website":
            insert(
                db,
                "users",
                id="alice",
                username="alice",
                username_normalized="alice",
                password_hash="fixture",
            )
            insert(
                db,
                "amadeus_conversations",
                id="amadeus",
                owner_user_id="alice",
                user_id="alice",
                title="Keep",
            )
            insert(
                db,
                "amadeus_messages",
                id="amadeus-message",
                owner_user_id="alice",
                conversation_id="amadeus",
                role="user",
                content="Keep reference",
                references_json='[{"id":"alice","kind":"file"}]',
            )
        if service == "visual":
            for request, kind in (("old", "conversation"), ("keep", "canvas")):
                insert(
                    db,
                    "visual_canvas_reference_mutations",
                    owner_user_id="alice",
                    request_id=request,
                    change_sha256="0" * 64,
                    change=f'{{"resource_kind":"{kind}"}}',
                    authority="",
                    state="committed",
                    deleted=False,
                )
        db.commit()

    for block, settle in GUARDS[service]:
        with runner.connect_database(path) as db:
            db.execute(block)
            db.commit()
            before = list(db.iterdump())
        with pytest.raises(sqlite3.IntegrityError, match="unsettled = 0"):
            migrate(path, service, monkeypatch)
        with runner.connect_database(path) as db:
            assert list(db.iterdump()) == before
            db.execute(settle)
            db.commit()

    migrate(path, service, monkeypatch)
    with runner.connect_database(path) as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert not db.execute(
            "SELECT name FROM sqlite_master WHERE name LIKE 'visual_assistant_%'"
        ).fetchall()
        if service in {"website", "models"}:
            assert (
                db.execute(
                    "SELECT call_source, total_tokens FROM llm_call_logs ORDER BY call_source"
                ).fetchall()
                == [("amadeus", 23)] * 2 + [("visual_workshop_generation", 23)] * 2
            )
        if service in {"website", "visual"}:
            assert db.execute("SELECT count(*) FROM visual_workshop_projects").fetchone() == (2,)
            assert (
                db.execute(
                    "SELECT revision, json_extract(nodes, '$[0].id') FROM visual_canvas_documents"
                ).fetchall()
                == [(4, "result")] * 2
            )
            assert db.execute(
                "SELECT count(*) FROM visual_generation_tasks WHERE status='completed'"
            ).fetchone() == (2,)
        if service == "website":
            assert db.execute("SELECT title FROM amadeus_conversations").fetchall() == [("Keep",)]
            assert db.execute(
                "SELECT json_extract(references_json, '$[0].id') FROM amadeus_messages"
            ).fetchall() == [("alice",)]
            assert db.execute("SELECT count(*) FROM visual_assets").fetchone() == (2,)
        if service == "visual":
            assert db.execute(
                "SELECT request_id FROM visual_canvas_reference_mutations"
            ).fetchall() == [("keep",)]
        if service == "models":
            assert db.execute("SELECT id FROM runtime_admissions ORDER BY id").fetchall() == [
                ("generation-alice",),
                ("generation-bob",),
            ]
        if service == "assets":
            assert db.execute("SELECT count(*) FROM visual_assets").fetchone() == (2,)
            for table in (
                "asset_reference_sets",
                "asset_reference_pins",
                "asset_reference_intents",
            ):
                assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (4,)
