"""Authorization precedes source access for both website and standalone Portal."""

from studio.apps.portal.ports import DocumentSource
from studio.contracts.identity.errors import AccountError


class DeveloperDocuments:
    def __init__(self, source: DocumentSource):
        self.source = source

    def read(self, principal):
        if not principal.allows("docs.developer"):
            raise AccountError("developer_docs_required")
        return {"items": self.source.read()}
