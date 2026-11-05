"""Authenticate maintenance HTTP calls against one sealed migration plan."""

import secrets

from fastapi import HTTPException, Request


class MigrationAdmission:
    def __init__(self, plan, *, platform=False):
        self.plan = plan
        self.owners = frozenset((plan.run_id,) if platform else plan.owner_ids)
        self.secret = plan.token.get_secret_value().encode()

    def authorize(self, request: Request):
        supplied = request.headers.get("X-Fpl-Migration-Token", "").encode()
        if (
            "origin" in request.headers
            or "cookie" in request.headers
            or not secrets.compare_digest(supplied, self.secret)
        ):
            raise HTTPException(403, {"code": "migration_authority_required"})

    def check_owner(self, owner):
        if owner not in self.owners:
            raise HTTPException(409, {"code": "migration_owner_unassigned"})

    def check_batch(self, request: Request, batch):
        self.check_owner(batch.owner_id)
        if (
            batch.run_id != self.plan.run_id
            or batch.source_revision != self.plan.source_revision
            or batch.source_database_sha256 != self.plan.source_database_sha256
        ):
            raise HTTPException(409, {"code": "migration_source_mismatch"})
        supplied = request.headers.get("X-Fpl-Migration-SHA256", "").encode()
        if not secrets.compare_digest(supplied, batch.digest.encode()):
            raise HTTPException(422, {"code": "migration_digest_mismatch"})
