"""Assets-only fresh verification of one short-lived published-file capability."""

import secrets
from dataclasses import asdict

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from app.apps.thought_workshop.errors import ThoughtError
from app.capabilities.identity.principal import StudioPrincipal
from fpl_runtime.claims import verify_context
from fpl_runtime.community_assets import CommunityAssetEvidence, verify_community_asset

from .community_access import published_asset

router = APIRouter(prefix="/_internal/v1/community-evidence", include_in_schema=False)


class VerifyEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: str = Field(min_length=1, max_length=16384)


class CommunityEvidenceVerifier:
    def __init__(self, database, *, public_key, identity, directory_factory):
        self.database, self.public_key = database, public_key
        self.identity, self.directory_factory = identity, directory_factory

    async def verify(self, authority):
        try:
            actor, source = verify_community_asset(authority, public_key=self.public_key)
            original = verify_context(
                source.source_assertion,
                service="thought",
                method=source.source_method,
                path=source.source_path,
                public_key=self.public_key,
            )
            if original != actor:
                return False
        except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
            return False
        status = await self.identity.status(
            assertion=source.source_assertion, method=source.source_method, path=source.source_path
        )
        if status is None:
            raise HTTPException(503, "community_asset_identity_unavailable")
        if status is not True:
            return False
        principal = StudioPrincipal(
            user_id=actor.user_id,
            must_change_password=False,
            platform_role=actor.platform_role,
            auth_kind=actor.auth_kind,
            scopes=frozenset(actor.scopes),
            session_id=actor.session_id,
        )
        directory = self.directory_factory(principal, source)
        try:
            async with self.database.sessions(
                info={"allow_system_reads": True, "thought_directory": directory}
            ) as session:
                actual = await published_asset(
                    session,
                    principal,
                    source.evidence.publication_id,
                    source.evidence.asset_id,
                    note_id=source.evidence.note_id,
                    cover=source.evidence.cover,
                )
                return CommunityAssetEvidence.model_validate(asdict(actual)) == source.evidence
        except ThoughtError as exc:
            if exc.status == 404:
                return False
            raise HTTPException(503, "community_asset_source_unavailable") from None


@router.post("/verify")
async def verify(request: Request, body: VerifyEvidence):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "community_asset_peer_required")
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    expected = getattr(request.app.state, "assets_community_peer_token", None)
    if (
        not isinstance(expected, str)
        or len(expected) < 32
        or not secrets.compare_digest(token.encode(), expected.encode())
    ):
        raise HTTPException(403, "community_asset_peer_required")
    verifier = getattr(request.app.state, "community_evidence", None)
    if not isinstance(verifier, CommunityEvidenceVerifier):
        raise HTTPException(503, "community_asset_source_unavailable")
    return JSONResponse(
        {"valid": await verifier.verify(body.authority)}, headers={"Cache-Control": "no-store"}
    )
