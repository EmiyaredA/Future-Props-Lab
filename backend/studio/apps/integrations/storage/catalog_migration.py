"""Owned integrations and encrypted connection configuration for sealed transfer."""

import json
from dataclasses import replace
from datetime import datetime
from functools import partial
from typing import Any, Literal

from cryptography.fernet import InvalidToken
from pydantic import Field
from sqlalchemy.orm import DeclarativeBase

from app.integrations.external.models import ExternalConnection
from app.integrations.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    ToolApiIntegration,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.migration_receipts import ImportReceiptFields
from studio.runtime.database.project_history_migration import ProjectDataset, blocked


class ReceiptBase(DeclarativeBase):
    pass


class IntegrationsImportReceipt(ImportReceiptFields, ReceiptBase):
    __tablename__ = "integrations_import_receipts"


class Connection(HistoryRecord):
    id: Identifier
    name: str
    enabled: bool
    status: str
    status_message: str
    last_checked_at: datetime | None
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ToolAPI(Connection):
    description: str
    method: str
    url: str
    auth_kind: str
    auth_header_name: str
    secret_ciphertext: str = Field(repr=False)
    parameters_schema: dict
    query_template: dict
    body_template: Any | None
    tags: list[str]
    sensitive_result: bool


class MCPServer(Connection):
    description: str
    transport: str
    url: str
    command: str
    arguments: list[str]
    bearer_ciphertext: str = Field(repr=False)
    environment_ciphertext: str = Field(repr=False)
    environment_keys: list[str]
    tags: list[str]
    server_name: str
    server_version: str
    protocol_version: str
    sensitive_result: bool


class External(Connection):
    provider: str
    app_id: str
    secret_ciphertext: str = Field(min_length=1, repr=False)


class MCPTool(HistoryRecord):
    id: Identifier
    server_id: Identifier
    name: str
    description: str
    input_schema: dict
    updated_at: datetime


class Check(HistoryRecord):
    id: Identifier
    resource_kind: str
    resource_id: Identifier
    resource_name: str
    ok: bool
    status_code: int | None
    latency_ms: int
    summary: str
    created_at: datetime


class ToolAPIBatch(MigrationBatch[ToolAPI]):
    dataset: Literal["integrations.tool-apis"]


class MCPServerBatch(MigrationBatch[MCPServer]):
    dataset: Literal["integrations.mcp-servers"]


class MCPToolBatch(MigrationBatch[MCPTool]):
    dataset: Literal["integrations.mcp-tools"]


class ExternalBatch(MigrationBatch[External]):
    dataset: Literal["integrations.external-connections"]


class CheckBatch(MigrationBatch[Check]):
    dataset: Literal["integrations.checks"]


DATASETS = (
    ProjectDataset(
        "integrations.tool-apis",
        ToolApiIntegration,
        ToolAPI,
        ToolAPIBatch,
        MigrationPage[ToolAPIBatch],
        page_size=16,
    ),
    ProjectDataset(
        "integrations.mcp-servers",
        McpIntegration,
        MCPServer,
        MCPServerBatch,
        MigrationPage[MCPServerBatch],
        page_size=16,
    ),
    ProjectDataset(
        "integrations.mcp-tools",
        McpDiscoveredTool,
        MCPTool,
        MCPToolBatch,
        MigrationPage[MCPToolBatch],
        project=McpIntegration,
        owns_record=False,
        page_size=64,
        parent_key="server_id",
    ),
    ProjectDataset(
        "integrations.external-connections",
        ExternalConnection,
        External,
        ExternalBatch,
        MigrationPage[ExternalBatch],
        page_size=16,
    ),
    ProjectDataset(
        "integrations.checks",
        IntegrationCheck,
        Check,
        CheckBatch,
        MigrationPage[CheckBatch],
        page_size=64,
    ),
)


async def verify_credential(cipher, _session, record):
    try:
        if isinstance(record, MCPServer):
            if record.bearer_ciphertext:
                cipher.decrypt(record.bearer_ciphertext)
            environment = (
                json.loads(cipher.decrypt(record.environment_ciphertext))
                if record.environment_ciphertext
                else {}
            )
            if (
                not isinstance(environment, dict)
                or sorted(environment) != sorted(record.environment_keys)
                or not all(isinstance(value, str) for value in environment.values())
            ):
                raise ValueError
        elif record.secret_ciphertext:
            cipher.decrypt(record.secret_ciphertext)
    except (InvalidToken, ValueError):
        raise blocked("migration_integration_credential_unreadable") from None


def verified_catalog(cipher):
    protected = {ToolAPI, MCPServer, External}
    return tuple(
        replace(dataset, validate=partial(verify_credential, cipher))
        if dataset.record in protected
        else dataset
        for dataset in DATASETS
    )
