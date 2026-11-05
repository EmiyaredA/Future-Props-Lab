"""Public account values and a short-lived actor snapshot from request-bound Identity HTTP."""

import time
from dataclasses import asdict, replace

import httpx

from app.apps.thought_workshop.errors import ThoughtError
from fpl_runtime.account_directory import AccountProfile, DirectoryQuery, DirectoryResult
from fpl_runtime.delegation import RequestGrant, permitted


class HttpAccountDirectory:
    def __init__(
        self,
        *,
        principal,
        assertion,
        source_method,
        source_path,
        credential,
        catalog,
        identity_url="http://identity:8080",
        transport=None,
    ):
        self.principal, self.assertion, self.method, self.path = (
            principal,
            assertion,
            source_method,
            source_path,
        )
        self.credential, self.catalog, self.identity_url, self.transport = (
            credential,
            catalog,
            identity_url,
            transport,
        )
        self.by_id, self.by_name, self.known_ids, self.known_names = {}, {}, set(), set()
        self.caller, self.checked_at = None, 0.0

    def for_session(self, _session):
        # This request's immutable identity values contain no database session.
        return self

    async def fetch(self, query):
        grant = RequestGrant(
            "thought",
            "thought.accounts.read",
            self.method,
            self.path,
            "identity",
            "POST",
            query.path,
        )
        if not permitted(grant, self.catalog):
            raise ThoughtError("账号目录请求未获授权", 403, "account_directory_forbidden")
        try:
            async with httpx.AsyncClient(
                trust_env=False, follow_redirects=False, timeout=3, transport=self.transport
            ) as client:
                authorized = await client.post(
                    self.identity_url + "/_internal/v1/authorization/delegate",
                    headers={"Authorization": "Bearer " + self.credential},
                    json={**asdict(grant), "assertion": self.assertion},
                )
                if authorized.status_code in {401, 403}:
                    raise ThoughtError(
                        "账号授权已失效", authorized.status_code, "account_authorization_revoked"
                    )
                if authorized.status_code != 200:
                    raise ThoughtError(
                        "账号权限已失效或目录暂不可用", 503, "account_directory_unavailable"
                    )
                token = authorized.json()["assertion"]
                if not isinstance(token, str) or not 1 <= len(token) <= 8192:
                    raise ValueError("invalid assertion")
                response = await client.post(
                    self.identity_url + query.path,
                    headers={"X-Fpl-Context": token},
                    json=query.model_dump(),
                )
                if response.status_code in {401, 403}:
                    raise ThoughtError(
                        "账号授权已失效", response.status_code, "account_authorization_revoked"
                    )
                if response.status_code != 200 or len(response.content) > 2 * 1024 * 1024:
                    raise ThoughtError(
                        "账号权限已失效或目录暂不可用", 503, "account_directory_unavailable"
                    )
                result = DirectoryResult.model_validate(response.json())
            if (
                result.caller.id != self.principal.user_id
                or result.caller.platform_role != self.principal.platform_role
            ):
                raise ValueError("unexpected caller")
            requested_ids, requested_names = set(query.ids), set(query.usernames)
            if any(
                profile.id not in requested_ids and profile.username.lower() not in requested_names
                for profile in result.profiles
            ):
                raise ValueError("unexpected account profile")
            self.caller, self.checked_at = result.caller, time.monotonic()
            self.known_ids.update(requested_ids)
            self.known_names.update(requested_names)
            for profile in (
                *result.profiles,
                AccountProfile(
                    id=result.caller.id,
                    username=result.caller.username,
                    display_name=result.caller.display_name,
                    active=result.caller.active,
                ),
            ):
                self.known_ids.add(profile.id)
                self.known_names.add(profile.username.lower())
                self.by_id[profile.id] = profile
                self.by_name[profile.username.lower()] = profile
            self.known_ids.add(result.caller.id)
            self.known_names.add(result.caller.username.lower())
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise ThoughtError("账号目录暂不可用", 503, "account_directory_unavailable") from None

    async def refresh(self):
        await self.fetch(DirectoryQuery(ids=[self.principal.user_id]))

    async def current(self, principal):
        if self.caller is None:
            await self.fetch(DirectoryQuery(ids=[principal.user_id]))
        if (
            principal.user_id != self.caller.id
            or not self.caller.active
            or time.monotonic() - self.checked_at > 5
        ):
            raise ThoughtError(
                "账号权限快照已过期，请重新提交", 503, "account_authorization_expired"
            )
        return replace(principal, platform_role=self.caller.platform_role)

    async def profiles(self, *, ids=(), usernames=()):
        query = DirectoryQuery(ids=list(ids), usernames=list(usernames))
        missing = DirectoryQuery(
            ids=sorted(set(query.ids) - self.known_ids),
            usernames=sorted(set(query.usernames) - self.known_names),
        )
        if missing.ids or missing.usernames:
            await self.fetch(missing)
        result = {id: self.by_id[id] for id in query.ids if id in self.by_id}
        result.update(
            {
                self.by_name[name].id: self.by_name[name]
                for name in query.usernames
                if name in self.by_name
            }
        )
        return list(result.values())
