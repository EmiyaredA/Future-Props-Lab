"""Resolve the published acceptance catalog from the two executor owners."""

import asyncio

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.apps.visual_workshop.acceptance.node_schemas import NodeAcceptanceCatalogOut
from app.apps.visual_workshop.acceptance.schemes import SCHEMES, catalog_out, scheme_out
from app.capabilities.agents.cli.definitions import DEFINITIONS
from app.deps import StudioAuth
from app.llm.schemas.visual_catalog import FixedAcceptanceModelOut
from fpl_runtime.agent_connections import AcceptanceAgentCatalog
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.visual_catalog import (
    AGENT_ACCEPTANCE_PURPOSE,
    AGENT_ACCEPTANCE_TARGET,
    FIXED_ACCEPTANCE_TARGET,
)

from .catalog_http import lookup

SOURCE = "/v1/visual-workshop/acceptance/catalog"
router = APIRouter(tags=["visual-workshop"])


async def agents(request, *, probe):
    client = request.app.state.capabilities
    grant = RequestGrant(
        "visual",
        AGENT_ACCEPTANCE_PURPOSE,
        request.method,
        request.url.path,
        "agent-runtime",
        "GET",
        AGENT_ACCEPTANCE_TARGET,
    )
    try:
        token = await client.authorize_request(request.state.service_assertion, grant)
        response = await client.client.get(
            "http://agent-runtime:8080" + AGENT_ACCEPTANCE_TARGET,
            headers={HEADER: token},
            params={"probe": str(probe).lower()},
            timeout=45,
        )
        if response.status_code in {401, 403}:
            raise CapabilityDenied(response.status_code)
        response.raise_for_status()
        return {
            item.id: item
            for item in AcceptanceAgentCatalog.model_validate_json(response.content).items
        }
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, "验收连接授权已撤销") from None
    except (httpx.HTTPError, CapabilityUnavailable, ValueError):
        return {}


async def available_schemes(request, *, probe=True):
    model_result, agent_results = await asyncio.gather(
        lookup(request, FIXED_ACCEPTANCE_TARGET, FixedAcceptanceModelOut),
        agents(request, probe=probe),
    )
    model = model_result.model
    schemes = []
    for identity, (title, kind) in SCHEMES.items():
        if kind == "model_api":
            schemes.append(
                scheme_out(
                    identity,
                    model is not None,
                    "已配置" if model is not None else "尚未配置本空间可用的固定视觉模型",
                    label=f"{model.label} · {model.provider_name}" if model is not None else title,
                    slug=model.slug if model is not None else "",
                    provider_kind=model.provider_kind if model is not None else "",
                )
            )
            continue
        agent = identity.removeprefix("motion-transfer:")
        status = agent_results.get(agent)
        schemes.append(
            scheme_out(
                identity,
                status.available if status is not None else False,
                status.message if status is not None else "本机 CLI 执行器不可用",
                label=DEFINITIONS[agent].name,
            )
        )
    return schemes


@router.get(SOURCE, response_model=NodeAcceptanceCatalogOut)
async def acceptance_catalog(request: Request, _principal: StudioAuth):
    return catalog_out(await available_schemes(request))
