"""Feishu's block and media APIs; no application ORM or source-editor dependencies."""

from __future__ import annotations

import json
import re
from time import monotonic

import httpx

from studio.contracts.integrations.external_documents import (
    ConnectionCredentials,
    DocumentTarget,
    ExternalError,
    ImageSource,
    RemoteDocument,
)

BASE = "https://open.feishu.cn/open-apis"
TOKEN_EXPIRED = {99991663}


class FeishuClient:
    def __init__(self, credentials: ConnectionCredentials, transport=None):
        self.credentials = credentials
        self.transport = transport
        self._token = ""
        self._expires = 0.0

    async def token(self) -> str:
        if self._token and monotonic() < self._expires:
            return self._token
        async with httpx.AsyncClient(
            transport=self.transport, timeout=30, follow_redirects=False, trust_env=False
        ) as client:
            response = await client.post(
                BASE + "/auth/v3/tenant_access_token/internal",
                json={"app_id": self.credentials.app_id, "app_secret": self.credentials.app_secret},
            )
        value = self._decode(response)
        token, expire = value.get("tenant_access_token"), value.get("expire")
        if not isinstance(token, str) or not token or not isinstance(expire, int):
            raise ExternalError("飞书鉴权未返回访问凭证", 502)
        self._token = token
        self._expires = monotonic() + max(0, expire - 120)
        return self._token

    @staticmethod
    def _decode(response: httpx.Response) -> dict:
        try:
            value = response.json()
        except ValueError:
            raise ExternalError("飞书返回了无效响应", 502) from None
        if not isinstance(value, dict) or not isinstance(value.get("code"), int):
            raise ExternalError("飞书返回了无效响应", 502)
        if response.is_error or value.get("code") != 0:
            code = value.get("code", response.status_code)
            # Provider messages and request bodies may contain credentials. Never expose them.
            if code == 1770032:
                raise ExternalError(
                    "应用还不能阅读或编辑这篇文档（错误码 1770032）。"
                    "请打开文档，在右上角「…」→「更多」→「添加文档应用」，并把应用设为可编辑。"
                    "若列表中没有该应用，请先开通「查看、评论、编辑和管理云文档」，并开启机器人。",
                    502,
                    "document_forbidden",
                    provider_code=code,
                )
            raise ExternalError(
                f"飞书请求失败（错误码 {code}），请检查应用权限与目标文档授权",
                502,
                provider_code=code,
            )
        return value

    async def request(self, method: str, path: str, **kwargs) -> dict:
        for attempt in range(2):
            token = await self.token()
            async with httpx.AsyncClient(
                transport=self.transport, timeout=60, follow_redirects=False, trust_env=False
            ) as client:
                response = await client.request(
                    method, BASE + path, headers={"Authorization": "Bearer " + token}, **kwargs
                )
            try:
                value = response.json()
                expired = isinstance(value, dict) and value.get("code") in TOKEN_EXPIRED
            except ValueError:
                expired = False
            if expired and attempt == 0:
                # Authentication rejection precedes execution; never retry ambiguous writes.
                self._token = ""
                continue
            data = self._decode(response).get("data", {})
            if not isinstance(data, dict):
                raise ExternalError("飞书返回了无效响应", 502)
            return data
        raise ExternalError("飞书访问凭证已失效", 502)

    async def resolve(self, target: DocumentTarget) -> tuple[str, str]:
        if target.kind == "docx":
            return target.token, target.url
        try:
            data = await self.request(
                "GET", "/wiki/v2/spaces/get_node", params={"token": target.token}
            )
        except ExternalError as exc:
            if exc.provider_code is None or exc.code == "document_forbidden":
                raise
            if exc.provider_code == 131006:
                raise ExternalError(
                    "应用还不能读取这篇知识库文档（错误码 131006）。"
                    "请打开文档，在右上角「…」→「更多」→「添加文档应用」，并把应用设为可编辑。"
                    "若列表中没有该应用，请先在开放平台开通「查看知识空间节点信息」。",
                    502,
                    "wiki_node_forbidden",
                ) from None
            if exc.provider_code == 99991672:
                raise ExternalError(
                    "应用尚未开通知识库节点读取权限（错误码 99991672）。"
                    "请在开放平台开通「查看知识空间节点信息」并发布新版本，再把该节点授权给应用。",
                    502,
                    "wiki_scope_required",
                ) from None
            raise ExternalError(
                "无法读取该知识库节点（错误码 "
                f"{exc.provider_code}）。请确认链接有效，并检查应用权限与节点授权",
                502,
            ) from None
        node = data.get("node")
        if not isinstance(node, dict):
            raise ExternalError("飞书返回了无效的知识库节点", 502)
        if node.get("obj_type") != "docx":
            raise ExternalError("该知识库节点不是新版文档。请打开新版文档后重新复制链接")
        document_id = node.get("obj_token")
        if not isinstance(document_id, str) or not re.fullmatch(r"[a-zA-Z0-9]+", document_id):
            raise ExternalError("飞书返回了无效的文档标识", 502)
        return document_id, f"https://{target.host}/docx/{document_id}"

    async def read(self, document_id: str) -> RemoteDocument:
        prefix = f"/docx/v1/documents/{document_id}"
        first = (await self.request("GET", prefix))["document"]
        blocks: list[dict] = []
        page = ""
        seen = set()
        while True:
            data = await self.request(
                "GET",
                prefix + "/blocks",
                params={
                    "page_size": 500,
                    "page_token": page,
                    "document_revision_id": first["revision_id"],
                },
            )
            blocks.extend(data.get("items", []))
            if len(blocks) > 20000:
                raise ExternalError("目标文档过大，请使用专用同步文档")
            if not data.get("has_more"):
                break
            page = data.get("page_token", "")
            if not page or page in seen:
                raise ExternalError("飞书文档分页结果异常", 502)
            seen.add(page)
        last = (await self.request("GET", prefix))["document"]
        if first["revision_id"] != last["revision_id"]:
            raise ExternalError("飞书文档正在变化，请重新预览", 409, "remote_changed")
        root = next((b for b in blocks if b["block_id"] == document_id), None)
        if root is None:
            raise ExternalError("飞书文档缺少根内容块", 502)
        return RemoteDocument(
            document_id, last["title"], last["revision_id"], blocks, list(root.get("children", []))
        )

    async def can_write(self, document_id: str) -> bool:
        data = await self.request(
            "GET",
            f"/drive/v1/permissions/{document_id}/members/auth",
            params={"type": "docx", "action": "edit"},
        )
        return data.get("auth_result") is True

    async def append(self, document_id: str, tree: dict, revision: int, request_id: str) -> dict:
        return await self.request(
            "POST",
            f"/docx/v1/documents/{document_id}/blocks/{document_id}/descendant",
            params={"document_revision_id": revision, "client_token": request_id},
            json={"children_id": tree["root_ids"], "descendants": tree["blocks"], "index": -1},
        )

    async def upload_image(self, document_id: str, block_id: str, image: ImageSource) -> str:
        data = await self.request(
            "POST",
            "/drive/v1/medias/upload_all",
            data={
                "file_name": image.filename,
                "parent_type": "docx_image",
                "parent_node": block_id,
                "size": str(len(image.data)),
                "extra": json.dumps({"drive_route_token": document_id}),
            },
            files={"file": (image.filename, image.data, image.content_type)},
        )
        if not data.get("file_token"):
            raise ExternalError("飞书素材上传未返回标识", 502)
        return data["file_token"]

    async def replace_image(
        self, document_id: str, block_id: str, token: str, revision: int, request_id: str
    ) -> dict:
        return await self.request(
            "PATCH",
            f"/docx/v1/documents/{document_id}/blocks/{block_id}",
            params={"document_revision_id": revision, "client_token": request_id},
            json={"replace_image": {"token": token}},
        )

    async def delete_prefix(
        self, document_id: str, count: int, revision: int, request_id: str
    ) -> dict:
        return await self.request(
            "DELETE",
            f"/docx/v1/documents/{document_id}/blocks/{document_id}/children/batch_delete",
            params={"document_revision_id": revision, "client_token": request_id},
            json={"start_index": 0, "end_index": count},
        )
