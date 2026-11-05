"""Resolve owned acceptance context through the Assets metadata port."""

import httpx
from pydantic import TypeAdapter

from studio.apps.visual_workshop.acceptance.acceptance_options import selected_scheme
from studio.apps.visual_workshop.acceptance.context_values import resolve_context
from studio.apps.visual_workshop.acceptance.node_records import NodeAcceptanceRecords
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_acceptance_assets import (
    PURPOSE,
    AcceptanceAsset,
    AcceptanceAssetQuery,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

ASSETS = TypeAdapter(list[AcceptanceAsset])


class AcceptanceContext:
    def __init__(self, request):
        self.request = request

    async def assets(self, project_id, ids):
        if not ids:
            return {}
        peer = self.request.app.state.capabilities
        try:
            query = AcceptanceAssetQuery(asset_ids=sorted(ids))
            target = query.path(project_id)
            grant = RequestGrant(
                "visual",
                PURPOSE,
                self.request.method,
                self.request.url.path,
                "assets",
                "POST",
                target,
            )
            token = await peer.authorize_request(self.request.state.service_assertion, grant)
            response = await peer.client.post(
                "http://assets:8080" + target, headers={HEADER: token}, json=query.model_dump()
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            response.raise_for_status()
            result = ASSETS.validate_json(response.content)
            actual = [item.id for item in result]
            if actual != sorted(set(actual)) or not set(actual).issubset(ids):
                raise ValueError("unexpected acceptance asset projection")
            return {item.id: item for item in result}
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "验收素材授权已撤销", "acceptance_assets_denied", exc.status
            ) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise ProjectResourceError(
                "验收素材暂不可读", "acceptance_assets_unavailable", 503
            ) from exc

    async def context(self, session, owner, project, node, scheme, output_id=None):
        async def scoped_assets(ids):
            return await self.assets(project, ids)

        return await resolve_context(
            session, owner, project, node, scheme, output_id, load_assets=scoped_assets
        )

    async def status(self, _session, _owner, _user, identity, *, check_cli):
        return await selected_scheme(self.request, identity, probe=check_cli)

    def nodes(self, session, principal):
        return NodeAcceptanceRecords(
            session,
            principal.owner_user_id,
            principal.user_id,
            resolve_context=self.context,
            scheme_status=self.status,
        )
