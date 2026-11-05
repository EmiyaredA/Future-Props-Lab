"""Private display-name lookup for an authorized Creative catalog operation."""

from pydantic import BaseModel, ConfigDict, Field

PATH = "/_internal/v1/creative-authors"
ITEM = "/v1/creative-workshop/items"
AUTHOR_OPERATIONS = frozenset(
    {
        ("GET", ITEM),
        ("GET", ITEM + "/{item_id}"),
        ("GET", "/v1/creative-workshop/releases/{release_id}"),
        ("POST", ITEM),
        ("POST", ITEM + "/from-integration"),
        ("PATCH", ITEM + "/{item_id}"),
        ("POST", ITEM + "/{item_id}/publish"),
        ("POST", ITEM + "/{item_id}/withdraw"),
        ("POST", ITEM + "/{item_id}/cover"),
        ("POST", ITEM + "/{item_id}/skill-archive"),
    }
)


class CreativeAuthorQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertion: str = Field(min_length=1, max_length=8192)
    source_method: str = Field(pattern=r"^(GET|POST|PATCH)$")
    source_path: str = Field(min_length=1, max_length=512)
    item_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    author_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


class CreativeAuthorName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(max_length=120)


def permits_author_query(catalog, query: CreativeAuthorQuery) -> bool:
    operation = catalog.match(query.source_method, query.source_path)
    if (
        operation is None
        or operation.service != "creative"
        or (operation.method, operation.path) not in AUTHOR_OPERATIONS
    ):
        return False
    return "{item_id}" not in operation.path or (
        operation.path.replace("{item_id}", query.item_id) == query.source_path
    )
