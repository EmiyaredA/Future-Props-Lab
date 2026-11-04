"""Explicit service requests exchange a verified source assertion for a narrow target token."""

from contextlib import asynccontextmanager
from dataclasses import asdict

import httpx

from .delegation import RequestGrant, permitted


class CapabilityUnavailable(RuntimeError):
    pass


class CapabilityDenied(RuntimeError):
    def __init__(self, status, code=None):
        super().__init__("跨服务请求被拒绝")
        self.status, self.code = status, code


class CapabilityClient:
    def __init__(
        self, *, service, credential, catalog, transport=None, identity_url="http://identity:8080"
    ):
        self.service, self.catalog = service, catalog
        self.credential, self.identity_url = credential, identity_url
        self.client = httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            timeout=10,
            transport=transport,
        )

    async def resource_exists(self, *, assertion, target_service, target_path):
        grant = RequestGrant(
            self.service,
            "automation.resource.read",
            "POST",
            "/v1/automation/open",
            target_service,
            "GET",
            target_path,
        )
        return await self._exists(assertion, grant)

    async def deployment_status(self, *, assertion):
        from .service_status import DeploymentServicesOut

        grant = RequestGrant(
            self.service,
            "deployment.status.read",
            "GET",
            "/v1/automation/services",
            "management",
            "GET",
            "/v1/management/service-status",
        )
        token = await self.authorize_request(assertion, grant)
        try:
            response = await self.client.get(
                "http://management:8080" + grant.target_path,
                headers={"X-Fpl-Context": token},
                timeout=2,
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            if response.status_code != 200:
                raise CapabilityUnavailable("主机监控暂不可读")
            return DeploymentServicesOut.model_validate(response.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("主机监控暂不可读") from exc

    async def project_exists(self, *, assertion, source_method, source_path, project_id):
        grant = RequestGrant(
            self.service,
            "assets.visual-project.read",
            source_method,
            source_path,
            "visual",
            "GET",
            "/v1/visual-workshop/projects/" + project_id,
        )
        return await self._exists(assertion, grant)

    @asynccontextmanager
    async def file_source(self, *, assertion, source_method, source_path, asset_id):
        grant = RequestGrant(
            self.service,
            "rendering.source.read",
            source_method,
            source_path,
            "assets",
            "GET",
            "/v1/files/" + asset_id + "/content",
        )
        token = await self.authorize_request(assertion, grant)
        try:
            async with self.client.stream(
                "GET",
                "http://assets:8080" + grant.target_path,
                headers={"X-Fpl-Context": token, "Accept-Encoding": "identity"},
            ) as response:
                if response.status_code in {401, 403, 404}:
                    raise CapabilityDenied(response.status_code)
                if response.status_code != 200:
                    raise CapabilityUnavailable("来源文件暂不可用")
                yield response
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("来源文件读取未确认") from exc

    @asynccontextmanager
    async def model_library_source(self, *, assertion, source_method, source_path, asset_id):
        grant = RequestGrant(
            self.service,
            "models.library-input.read",
            source_method,
            source_path,
            "assets",
            "GET",
            "/_internal/v1/model-library-inputs/" + asset_id,
        )
        token = await self.authorize_request(assertion, grant)
        try:
            async with self.client.stream(
                "GET",
                "http://assets:8080" + grant.target_path,
                headers={"X-Fpl-Context": token, "Accept-Encoding": "identity"},
            ) as response:
                if response.status_code in {401, 403, 404, 422}:
                    raise CapabilityDenied(response.status_code)
                if response.status_code != 200:
                    raise CapabilityUnavailable("文件库输入暂不可读")
                yield response
        except httpx.HTTPError as exc:
            raise CapabilityUnavailable("文件库输入传输未确认") from exc

    async def model_library_output(
        self, *, assertion, source_method, source_path, task_id, description, content
    ):
        from .model_outputs import model_output_path

        grant = RequestGrant(
            self.service,
            "models.library-output.write",
            source_method,
            source_path,
            "assets",
            "POST",
            model_output_path(task_id, description.fingerprint),
        )
        token = await self.authorize_request(assertion, grant)
        try:
            response = await self.client.post(
                "http://assets:8080" + grant.target_path,
                headers={
                    "X-Fpl-Context": token,
                    "X-Fpl-Output-Descriptor": description.header(),
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(description.byte_size),
                },
                content=content,
                timeout=httpx.Timeout(600, connect=5),
            )
            if response.status_code in {401, 403, 404, 409, 413, 422}:
                raise CapabilityDenied(response.status_code)
            if response.status_code != 200:
                raise CapabilityUnavailable("模型结果保存未确认")
            return response.json()
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("模型结果保存未确认") from exc

    async def authorize_request(self, assertion, grant):
        if grant.caller != self.service or not permitted(grant, self.catalog):
            raise CapabilityDenied(403)
        try:
            delegated = await self.client.post(
                self.identity_url + "/_internal/v1/authorization/delegate",
                headers={"Authorization": "Bearer " + self.credential},
                json={**asdict(grant), "assertion": assertion},
            )
            if delegated.status_code in {401, 403}:
                raise CapabilityDenied(delegated.status_code)
            if delegated.status_code != 200:
                raise CapabilityUnavailable("跨服务授权暂不可用")
            token = delegated.json()["assertion"]
            if not isinstance(token, str) or not 1 <= len(token) <= 8192:
                raise ValueError("invalid assertion")
            return token
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("跨服务授权未确认") from exc

    async def _exists(self, assertion, grant):
        token = await self.authorize_request(assertion, grant)
        try:
            async with self.client.stream(
                "GET",
                f"http://{grant.target_service}:8080" + grant.target_path,
                headers={"X-Fpl-Context": token},
            ) as response:
                if response.status_code == 404:
                    return False
                if response.status_code in {401, 403}:
                    raise CapabilityDenied(response.status_code)
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError("unexpected resource status")
                return True
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("所属应用暂不可用，未确认资源归属") from exc

    async def close(self):
        await self.client.aclose()
