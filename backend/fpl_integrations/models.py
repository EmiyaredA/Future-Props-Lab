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

from .creative_records import (
    CreativeInstallCancellation,
    CreativeInstalledPart,
    CreativeInstallReceipt,
)
from .demo_records import DemoToolInstallation
from .native_mcp_records import NativeMcpJob, NativeMcpObservation
from .records import ExternalClosure, ExternalExecution, ExternalStepReceipt, ValidationAttempt

MODELS = (
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
