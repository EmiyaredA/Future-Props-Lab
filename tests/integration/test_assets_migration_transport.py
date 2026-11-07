import httpx
import pytest
from scripts.website.migrate_assets import manifest
from scripts.website.migration_transfer import MigrationConnectionError, connection_failure


def test_manifest_retries_one_dropped_connection_with_extra_read_budget():
    attempts = []

    def handle(request):
        attempts.append(request)
        if len(attempts) == 1:
            raise httpx.RemoteProtocolError("disconnected", request=request)
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(handle), timeout=30) as client:
        assert (
            manifest(client, "http://127.0.0.1:1234", "owner", {}, complete=True, peer="源端") == []
        )
    assert len(attempts) == 2
    assert all(request.extensions["timeout"]["read"] == 180 for request in attempts)
    assert all(request.extensions["timeout"]["connect"] == 30 for request in attempts)


def test_manifest_timeout_reports_phase_without_leaking_request_details():
    attempts = []

    def handle(request):
        attempts.append(request)
        raise httpx.ReadTimeout("private-owner-id private-token", request=request)

    with (
        httpx.Client(transport=httpx.MockTransport(handle)) as client,
        pytest.raises(MigrationConnectionError) as captured,
    ):
        manifest(
            client,
            "http://127.0.0.1:1234",
            "private-owner-id",
            {"X-Fpl-Migration-Token": "private-token"},
            complete=True,
            peer="目标端",
        )
    assert len(attempts) == 1
    message = connection_failure(captured.value)
    assert message == "迁移维护服务连接失败（素材目标端原件清单：ReadTimeout）\n"
