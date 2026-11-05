"""Integrations owns its catalogues; account references never cross database foreign keys."""

from app.integrations.external.models import ExternalConnection
from app.integrations.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from studio.apps.integrations.records import (
    AmadeusToolCall,
    ExternalClosure,
    ExternalExecution,
    ExternalStepReceipt,
    ValidationAttempt,
)
from studio.apps.integrations.storage.creative_records import (
    CreativeInstallCancellation,
    CreativeInstalledPart,
    CreativeInstallReceipt,
)
from studio.apps.integrations.storage.demo_records import DemoToolInstallation
from studio.apps.integrations.storage.native_mcp_records import NativeMcpJob, NativeMcpObservation

MODELS = (
    AmadeusToolCall,
    CreativeInstalledPart,
    CreativeInstallReceipt,
    CreativeInstallCancellation,
    NativeMcpJob,
    NativeMcpObservation,
    DemoToolInstallation,
    ExternalClosure,
    ValidationAttempt,
    ExternalExecution,
    ExternalStepReceipt,
    ToolApiIntegration,
    McpIntegration,
    McpDiscoveredTool,
    SkillIntegration,
    SkillVersion,
    IntegrationCheck,
    ExternalConnection,
)
