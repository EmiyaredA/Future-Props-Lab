"""Public resource addresses used by account-checked automation navigation."""

from dataclasses import dataclass
from types import MappingProxyType
from urllib.parse import urlencode


@dataclass(frozen=True)
class ResourceRoute:
    service: str
    api: str
    page: str
    suffix: str = ""


RESOURCE_ROUTES = MappingProxyType(
    {
        "visual": ResourceRoute(
            "visual",
            "/v1/visual-workshop/projects/{id}",
            "/apps/visual-workshop/projects/",
            "/canvas",
        ),
        "galgame": ResourceRoute(
            "galgame",
            "/v1/galgame-workshop/projects/{id}",
            "/apps/galgame-workshop/projects/",
            "/editor",
        ),
        "video": ResourceRoute(
            "video", "/v1/video-editor/projects/{id}", "/apps/video-editor/projects/"
        ),
        "presentation": ResourceRoute(
            "presentation",
            "/v1/presentation-workshop/projects/{id}",
            "/apps/presentation-workshop/projects/",
        ),
        "annotation": ResourceRoute(
            "annotation", "/v1/audio-annotation/projects/{id}", "/apps/audio-annotation/projects/"
        ),
        "director": ResourceRoute(
            "director", "/v1/director-desk/projects/{id}", "/apps/director-desk/projects/"
        ),
        "note": ResourceRoute(
            "thought", "/v1/thought-workshop/notes/{id}", "/apps/thought-workshop/notes/"
        ),
        "knowledge": ResourceRoute(
            "thought",
            "/v1/thought-workshop/knowledge-bases/{id}",
            "/apps/thought-workshop/knowledge-bases/",
        ),
        "skill": ResourceRoute(
            "integrations", "/v1/integrations/skills/{id}", "/integrations/skills"
        ),
        "tool-api": ResourceRoute(
            "integrations", "/v1/integrations/tool-apis/{id}", "/integrations/tool-apis"
        ),
        "mcp": ResourceRoute("integrations", "/v1/integrations/mcp/{id}", "/integrations/mcp"),
    }
)


def page_link(kind, resource_id=None, view=None):
    route = RESOURCE_ROUTES[kind]
    if kind in {"skill", "tool-api", "mcp"}:
        query = {"view": view}
        if resource_id:
            query["resource"] = resource_id
        return route.page + "?" + urlencode(query)
    return route.page + resource_id + route.suffix
