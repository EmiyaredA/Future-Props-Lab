"""Document sources are replaceable and are never read before authorization."""

import pytest

from studio.apps.portal.storage.documents import InstalledDocuments
from studio.apps.portal.use_cases.documents import DeveloperDocuments
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.principal import StudioPrincipal


@pytest.mark.parametrize("installed", [False, True])
def test_document_source_contract(tmp_path, installed):
    class MemoryDocuments:
        def read(self):
            return [
                {
                    "id": "dev-README",
                    "source": "../../../README.md",
                    "group": "operations",
                    "markdown": "public engineering guide",
                }
            ]

    (tmp_path / "README.md").write_text("public engineering guide")
    (tmp_path / "config.toml").write_text("private settings must not be read")
    source = InstalledDocuments(tmp_path) if installed else MemoryDocuments()
    principal = StudioPrincipal(
        "owner", False, "session", frozenset({"studio:read", "studio:private_read"}), "admin"
    )
    result = DeveloperDocuments(source).read(principal)
    assert result == {"items": MemoryDocuments().read()}


def test_permission_denied_does_not_read_source():
    class NeverRead:
        def read(self):
            raise AssertionError("unauthorized document source access")

    principal = StudioPrincipal("owner", False, "session", frozenset())
    with pytest.raises(AccountError):
        DeveloperDocuments(NeverRead()).read(principal)
