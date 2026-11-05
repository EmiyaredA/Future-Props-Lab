"""Compatibility storage for registered demo settings; execution owns no database."""

from app.console.models.platform_governance import PlatformSetting
from studio.apps.model_service.demonstration.execution import DEFAULT_CONFIG


async def read_demo_configuration(service_id, *, sessions):
    async with sessions() as session:
        row = await session.get(PlatformSetting, f"demo_service:{service_id}")
        return {**DEFAULT_CONFIG, **(row.payload if row else {})}
