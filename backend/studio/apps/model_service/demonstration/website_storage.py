"""Compatibility storage for registered demo settings; execution owns no database."""

from studio.apps.model_service.demonstration.execution import DEFAULT_CONFIG
from studio.apps.model_service.storage.website_settings import read_setting


async def read_demo_configuration(service_id, *, sessions):
    async with sessions() as session:
        state = await read_setting(session, f"demo_service:{service_id}", {})
        return {**DEFAULT_CONFIG, **state["value"]}
