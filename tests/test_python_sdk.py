"""Exercise the installed client's actual wire contract, without provider calls."""

import json
import sys
from pathlib import Path

import httpx
import pytest

from website_test_support import app

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))

from future_props_lab import UNSET, AsyncClient, Client, TaskTimeout, models  # noqa: E402
from future_props_lab.encoding import encode  # noqa: E402
from future_props_lab.streams import EventDecoder  # noqa: E402


def test_models_keep_omitted_fields_and_aliases():
    body = models.ProviderIn.model_construct(name="new")
    assert encode(body) == {"name": "new"}
    assert encode({"a": None, "b": UNSET}) == {"a": None}


def test_named_methods_attach_auth_and_do_not_replay_writes():
    calls = []

    def respond(request):
        calls.append(request)
        assert request.headers["authorization"] == "Bearer fpm_test"
        return httpx.Response(503, json={"code": "busy"})

    from future_props_lab import ApiError

    with Client(
        base_url="http://test", api_key="fpm_test", transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(ApiError) as failure:
            client.presentation.create_project(body={"title": "test", "document": {}})
        assert failure.value.status == 503
        assert "fpm_test" not in repr(client)
    assert len(calls) == 1
    assert calls[0].url.path == "/v1/presentation-workshop/projects"


def test_session_client_sends_cookie_csrf_and_origin():
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(204)

    with Client(base_url="http://test", transport=httpx.MockTransport(respond)) as client:
        client._http.cookies.set("fpl_csrf", "csrf-token")
        client._http.cookies.set("fpl_session", "session-token")
        client.accounts.reauth(body={"password": "never-log-this"})
    request = calls[0]
    assert request.headers["x-csrf-token"] == "csrf-token"
    assert request.headers["origin"] == "http://test"
    assert "fpl_session=session-token" in request.headers["cookie"]


def test_event_decoder_handles_comments_multiline_and_event_ids():
    decoder = EventDecoder()
    for line in [": heartbeat", "id: 3", "event: delta", 'data: {"text":', 'data: "你好"}']:
        assert decoder.feed(line) is None
    event = decoder.feed("")
    assert event.type == "delta" and event.id == "3" and event.text == "你好"
    assert decoder.feed("") is None


@pytest.mark.asyncio
async def test_async_download_and_timeout_do_not_cancel_server_task(tmp_path):
    async def respond(_request):
        return httpx.Response(200, content=b"artifact", headers={"content-type": "application/zip"})

    async with AsyncClient(
        base_url="http://test", transport=httpx.MockTransport(respond)
    ) as client:
        result = await client._call("GET", "/download")
        async with result:
            await result.save(tmp_path / "result.zip")
        assert (tmp_path / "result.zip").read_bytes() == b"artifact"

        async def fetch():
            return {"status": "pending"}

        with pytest.raises(TaskTimeout) as failure:
            await client.wait_for(fetch, task_id="existing-task", timeout=0.001, interval=0.001)
        assert failure.value.task_id == "existing-task"


def test_all_inventory_operations_have_sync_async_methods():
    mapping = json.loads(
        (Path(__file__).resolve().parents[1] / "sdk/python/operations.json").read_text()
    )
    from future_props_lab.generated.resources import ASYNC_RESOURCES, RESOURCES

    for entry in mapping.values():
        assert callable(getattr(RESOURCES[entry["resource"]], entry["method"]))
        assert callable(getattr(ASYNC_RESOURCES[entry["resource"]], entry["method"]))


@pytest.mark.asyncio
async def test_documented_async_example_creates_server_valid_document():
    from future_props_lab.examples import create_deck_async

    async with AsyncClient(
        base_url="http://test", transport=httpx.ASGITransport(app=app)
    ) as client:
        project = await create_deck_async(client)
        assert project.revision == 0
        assert len(project.document.slides) == 1
        reread = await client.presentation.get_project(project_id=project.id)
        assert reread.document == project.document


def test_documented_sync_example_and_wire_aliases():
    import asyncio

    from future_props_lab.examples import create_deck, update_slide_notes

    def respond(request):
        async def execute():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as server:
                response = await server.send(request)
                return httpx.Response(
                    response.status_code, headers=response.headers, content=response.content
                )

        return asyncio.run(execute())

    with Client(base_url="http://test", transport=httpx.MockTransport(respond)) as client:
        project = create_deck(client)
        saved = update_slide_notes(client, project, "From a tested example")
        assert saved.revision == 1
        assert saved.document.slides[0].notes == "From a tested example"


def test_sensitive_model_fields_are_hidden():
    login = models.LoginIn(username="example", password="do-not-display")
    assert "do-not-display" not in repr(login)
    assert encode(login)["password"] == "do-not-display"


def test_realtime_protocol_audio_mute_interrupt_and_close(monkeypatch):
    messages = []

    class Socket:
        def send(self, message):
            messages.append(json.loads(message))

        def close(self):
            messages.append("closed")

        def __iter__(self):
            return iter(['{"type":"audio","data":"AAA="}'])

    def connect(url, **kwargs):
        assert url == "ws://test/v1/model-test/realtime"
        assert kwargs["origin"] == "http://test"
        assert "fpl_session" in kwargs["additional_headers"]["Cookie"]
        return Socket()

    monkeypatch.setattr("websockets.sync.client.connect", connect)
    with Client(base_url="http://test") as client:
        client._http.cookies.set("fpl_session", "test-session")
        with client.realtime() as voice:
            voice.start(model_id="voice-model", voice="default", instructions="test")
            voice.audio(b"\0\0")
            voice.mute(True)
            voice.audio(b"\1\1")
            voice.interrupt()
            voice.commit_input(turn_id="turn-1")
            voice.stop()
            assert list(voice)[0].type == "audio"
    assert [m["type"] for m in messages[:-1]] == [
        "start",
        "audio",
        "interrupt",
        "commit_input",
        "stop",
    ]
    assert messages[-1] == "closed"


@pytest.mark.asyncio
async def test_every_named_operation_reaches_declared_http_route():
    from scripts.contracts.generate_sdk import identifier

    root = Path(__file__).resolve().parents[1]
    mapping = json.loads((root / "sdk/python/operations.json").read_text())
    schema = json.loads((root / "web/src/generated/openapi.json").read_text())
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(204)

    with Client(base_url="http://test", transport=httpx.MockTransport(respond)) as sync:
        async with AsyncClient(
            base_url="http://test", transport=httpx.MockTransport(respond)
        ) as asynchronous:
            for key, entry in mapping.items():
                method, path = key.split(" ", 1)
                op = schema["paths"][path][method.lower()]
                args = {}
                expected = path
                for param in op.get("parameters", []):
                    if not param.get("required"):
                        continue
                    value = (
                        1 if param["schema"].get("type") in {"integer", "number"} else "fixture-id"
                    )
                    args[identifier(param["name"])] = value
                    if param["in"] == "path":
                        expected = expected.replace("{" + param["name"] + "}", str(value))
                if op.get("requestBody", {}).get("required"):
                    args["body"] = {}
                getattr(getattr(sync, entry["resource"]), entry["method"])(**args)
                await getattr(getattr(asynchronous, entry["resource"]), entry["method"])(**args)
                assert calls[-1].method == calls[-2].method == method
                assert calls[-1].url.path == calls[-2].url.path == expected


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_sdk_session_login_reauth_and_workspace_key_isolation():
    from future_props_lab import ApiError
    from future_props_lab.builders import edit_batch, entity_edit
    from future_props_lab.examples import create_deck_async
    from tests.test_account_system import create_test_account

    first_account = await create_test_account()
    second_account = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(base_url="http://test", transport=transport) as first:
        async with AsyncClient(base_url="http://test", transport=transport) as second:
            for client, (username, temporary) in [(first, first_account), (second, second_account)]:
                await client.accounts.login(body={"username": username, "password": temporary})
                await client.accounts.change_current_password(
                    body={"current_password": temporary, "new_password": "SDK-Test-Password-2026!"}
                )
                await client.accounts.reauth(body={"password": "SDK-Test-Password-2026!"})
            project = await create_deck_async(first)
            with pytest.raises(ApiError) as hidden:
                await second.presentation.apply_presentation_operations(
                    project_id=project.id,
                    body=edit_batch(
                        0,
                        entity_edit(
                            "slide",
                            "update",
                            project.document.slides[0].id,
                            value={"notes": "foreign"},
                        ),
                    ),
                )
            assert hidden.value.status == 404
            key = await first.accounts.add_api_key(
                body={"name": "read-only SDK", "scopes": ["studio:read"], "expires_in_days": 1}
            )
            assert key.secret not in repr(key)
            async with AsyncClient(
                base_url="http://test", api_key=key.secret, transport=transport
            ) as reader:
                assert (
                    await reader.presentation.get_project(project_id=project.id)
                ).id == project.id
                with pytest.raises(ApiError) as denied:
                    await create_deck_async(reader)
                assert denied.value.status == 403
                with pytest.raises(ApiError) as session_only:
                    await reader.accounts.sessions()
                assert session_only.value.status == 403


@pytest.mark.asyncio
async def test_sse_disconnect_closes_stream_without_resubmission():
    closed, submitted = [], []

    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"type":"delta","text":"one"}\n\n'
            raise httpx.ReadError("deterministic disconnect")

        async def aclose(self):
            closed.append(True)

    def respond(request):
        submitted.append(request)
        return httpx.Response(200, stream=Chunks(), headers={"content-type": "text/event-stream"})

    async with AsyncClient(
        base_url="http://test", transport=httpx.MockTransport(respond)
    ) as client:
        stream = await client.inference.stream_text(
            body={"model_id": "id", "messages": [{"role": "user", "text": "hello"}]}
        )
        async with stream:
            with pytest.raises(httpx.ReadError):
                async for event in stream:
                    assert event.text == "one"
    assert closed and len(submitted) == 1


def test_inference_sse_result_is_typed():
    from future_props_lab.streams import InferenceEvent, event_model_for

    decoder = EventDecoder(event_model_for("/v1/model-inference/text/stream"))
    decoder.feed('data: {"type":"done","result":{"text":"ok","log_id":"log-1"}}')
    event = decoder.feed("")
    assert isinstance(event, InferenceEvent)
    assert isinstance(event.result, models.InferenceTextOut)
    assert event.result.text == "ok"
