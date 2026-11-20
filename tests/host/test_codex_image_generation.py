"""Native image events retain bytes without trusting paths or widening ordinary tools."""

import base64
import io

import pytest
from PIL import Image

from studio.host.agent_execution.cli.conversation import codex_command, verify_codex_policy
from studio.host.agent_execution.cli.image_generation import ImageGeneration, generated_bytes
from studio.host.agent_execution.cli.transport import CliError


def png():
    output = io.BytesIO()
    Image.new("RGBA", (3, 2), (200, 100, 20, 80)).save(output, format="PNG")
    return output.getvalue()


def test_image_command_is_explicit_and_has_no_host_read_access(tmp_path):
    ordinary, _ = codex_command("codex", tmp_path)
    enabled, _ = codex_command("codex", tmp_path, image_generation=True)
    assert "features.image_generation=false" in ordinary
    assert "features.image_generation=true" in enabled
    assert 'sandbox_mode="read-only"' not in enabled
    assert 'default_permissions="fpl-images"' in enabled
    assert "features.shell_tool=false" in enabled
    assert "features.plugins=false" in enabled
    policy = {
        "sandbox_mode": None,
        "default_permissions": "fpl-images",
        "permissions": {
            "fpl-images": {"filesystem": {str(tmp_path): "read"}, "network": {"enabled": False}}
        },
        "approval_policy": "never",
        "web_search": "disabled",
        "cli_auth_credentials_store": "file",
        "features": {
            "image_generation": True,
            "skip_host_skill_discovery": True,
            **dict.fromkeys(
                ("shell_tool", "hooks", "plugins", "apps", "multi_agent", "skill_search"), False
            ),
        },
    }
    verify_codex_policy({"config": policy}, image_root=tmp_path)
    policy["permissions"]["fpl-images"]["filesystem"]["/"] = "read"
    with pytest.raises(CliError, match="隔离"):
        verify_codex_policy({"config": policy}, image_root=tmp_path)


@pytest.mark.parametrize("source", ["inline", "file", "data-url"])
async def test_native_image_items_publish_once_and_preserve_transparency(tmp_path, source):
    data = png()
    profile, root = tmp_path / "profile", tmp_path / "work"
    target = profile / "generated_images" / "thread" / "item.png"
    target.parent.mkdir(parents=True)
    target.write_bytes(data)
    events, saved = [], []

    async def emit(kind, payload):
        events.append((kind, payload))

    async def save(identity, content):
        saved.append((identity, content))

    images = ImageGeneration(emit, save, profile, root)
    item = {"id": "item", "status": "completed", "savedPath": str(target), "fileId": "remote-id"}
    if source != "file":
        item["result"] = base64.b64encode(data).decode()
        if source == "data-url":
            item["result"] = "data:image/png;base64," + item["result"]
        # Inline data must work even when upstream cannot save an original.
        item.pop("savedPath")
    await images.accept("item/started", {"id": "item"}, "thread")
    await images.accept("item/completed", item, "thread")
    await images.accept("item/completed", item, "thread")
    assert saved == [("item", data)]
    assert events == [("image_generation", {"item_id": "item", "status": "started"})]
    assert not images.failed
    with Image.open(io.BytesIO(saved[0][1])) as image:
        assert image.getpixel((0, 0)) == (200, 100, 20, 80)


@pytest.mark.parametrize(
    "unsafe", ["outside", "other-thread", "symlink", "invalid-base64", "file-id-only"]
)
def test_image_sources_are_bounded_to_current_thread(tmp_path, unsafe):
    profile, root = tmp_path / "profile", tmp_path / "work"
    target = profile / "generated_images" / "thread" / "item.png"
    target.parent.mkdir(parents=True)
    item = {"id": "item", "savedPath": str(target)}
    if unsafe == "outside":
        item["savedPath"] = str(tmp_path / "secret.png")
    elif unsafe == "other-thread":
        item["savedPath"] = str(profile / "generated_images" / "another" / "item.png")
    elif unsafe == "symlink":
        private = tmp_path / "private.png"
        private.write_bytes(png())
        target.symlink_to(private)
    elif unsafe == "invalid-base64":
        item["result"] = "not an image!"
    else:
        item = {"id": "item", "fileId": "remote-id"}
    with pytest.raises((CliError, OSError)):
        generated_bytes(item, profile, root, "thread")


async def test_failed_provider_does_not_publish_or_retry(tmp_path):
    events, saves = [], []

    async def emit(_kind, payload):
        events.append(payload)

    async def save(*args):
        saves.append(args)

    receiver = ImageGeneration(emit, save, tmp_path, tmp_path)
    await receiver.accept("item/completed", {"id": "failed", "status": "failed"}, "thread")
    assert receiver.failed and not saves
    assert events[-1]["status"] == "failed"
    assert "result" not in str(events)
