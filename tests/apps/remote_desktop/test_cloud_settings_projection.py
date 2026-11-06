"""Publish consistent cloud policy while containers receive only their own fields."""

import hashlib

import pytest

from studio.config import ConfigurationError
from studio.config.cloud_projection import COMMIT, CloudProjection
from studio.host.cloud_projection import CloudPublisher


def test_cloud_projection_commit_changes_both_owner_views_together(tmp_path):
    publisher = CloudPublisher(tmp_path)
    policy = CloudProjection("identity", tmp_path / "identity", tmp_path / "committed")
    remote = CloudProjection("remote", tmp_path / "remote", tmp_path / "committed")
    publisher.synchronize(b"[cloud_control]\nhost_label = 'Old Mac'\n")
    candidate = publisher.prepare(
        b"[cloud_control]\nenabled = true\nadmin_user_ids = ['owner']\nhost_label = 'New Mac'\n"
        b"vnc_password = 'never-published'\napps_enabled = true\n"
    )
    assert remote.read() == {
        "fpl_cloud_control_host_label": "Old Mac",
        "fpl_cloud_control_apps_enabled": False,
        "fpl_cloud_control_apps_allowed": "",
    }
    assert policy.read()["fpl_cloud_control_enabled"] is False
    publisher.commit(candidate)
    assert remote.read() == {
        "fpl_cloud_control_host_label": "New Mac",
        "fpl_cloud_control_apps_enabled": True,
        "fpl_cloud_control_apps_allowed": "",
    }
    assert policy.read() == {
        "fpl_cloud_control_enabled": True,
        "fpl_cloud_control_public_enabled": False,
        "fpl_cloud_control_public_desktop_vnc_only": False,
        "fpl_cloud_control_admin_user_ids": "owner",
    }
    assert all("never-published" not in path.read_text() for path in tmp_path.rglob("*.toml"))
    assert all("owner" not in path.read_text() for path in (tmp_path / "remote").glob("*.toml"))
    publisher.commit(candidate)


def test_cloud_projection_rejects_wrong_owner_fields_and_changed_bytes(tmp_path):
    publisher = CloudPublisher(tmp_path)
    publisher.synchronize(b"[cloud_control]\nhost_label = 'Safe'\n")
    remote = CloudProjection("remote", tmp_path / "remote", tmp_path / "committed")
    marker = tmp_path / "committed" / COMMIT
    old = marker.read_text()
    document = b"[cloud_control]\nhost_label = 'Injected'\nenabled = true\n"
    digest = hashlib.sha256(document).hexdigest()
    current = next((tmp_path / "remote").glob("*.toml"))
    injected = tmp_path / "remote" / (digest + ".toml")
    injected.write_bytes(document)
    marker.write_text(old.replace(current.stem, digest))
    with pytest.raises(ConfigurationError, match="未授权字段"):
        remote.read()
    marker.write_text(old)
    current.write_bytes(document)
    with pytest.raises(ConfigurationError, match="摘要不匹配"):
        remote.read()
