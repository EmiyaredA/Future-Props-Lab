"""Resolve the published acceptance catalog from the two executor owners."""

import asyncio

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.llm.schemas.visual_catalog import FixedAcceptanceModelOut
from studio.apps.visual_workshop.acceptance.node_schemas import NodeAcceptanceCatalogOut
from studio.apps.visual_workshop.acceptance.schemes import SCHEMES, catalog_out, scheme_out
from studio.apps.visual_workshop.transport.catalog_http import lookup
from studio.assembly.http_dependencies import StudioAuth
from studio.contracts.agent_runtime.connections import AcceptanceAgentCatalog
from studio.contracts.agent_runtime.definitions import DEFINITIONS
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_catalog import (
    AGENT_ACCEPTANCE_PURPOSE,
    AGENT_ACCEPTANCE_TARGET,
    FIXED_ACCEPTANCE_TARGET,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

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


async def fixed_model(request):
    result = await lookup(request, FIXED_ACCEPTANCE_TARGET, FixedAcceptanceModelOut)
    return result.model


def model_scheme(model):
    identity = "motion-transfer:api"
    return scheme_out(
        identity,
        model is not None,
        "已配置" if model is not None else "尚未配置本空间可用的固定视觉模型",
        label=f"{model.label} · {model.provider_name}"
        if model is not None
        else SCHEMES[identity][0],
        slug=model.slug if model is not None else "",
        provider_kind=model.provider_kind if model is not None else "",
    )


def agent_scheme(identity, agent_results):
    agent = identity.removeprefix("motion-transfer:")
    status = agent_results.get(agent)
    return scheme_out(
        identity,
        status.available if status is not None else False,
        status.message if status is not None else "本机 CLI 执行器不可用",
        label=DEFINITIONS[agent].name,
    )


async def available_schemes(request, *, probe=True):
    model, agent_results = await asyncio.gather(fixed_model(request), agents(request, probe=probe))
    return [
        model_scheme(model) if kind == "model_api" else agent_scheme(identity, agent_results)
        for identity, (_title, kind) in SCHEMES.items()
    ]


async def selected_scheme(request, identity, *, probe):
    if identity == "motion-transfer:api":
        return model_scheme(await fixed_model(request))
    return agent_scheme(identity, await agents(request, probe=probe))


@router.get(SOURCE, response_model=NodeAcceptanceCatalogOut)
async def acceptance_catalog(request: Request, _principal: StudioAuth):
    return catalog_out(await available_schemes(request))
