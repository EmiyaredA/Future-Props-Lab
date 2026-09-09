from typing import Any, Literal

from pydantic import BaseModel, Field

ServiceId = Literal["mock_model", "example_tools"]


class DemoConfig(BaseModel):
    enabled: bool = False
    delay_ms: int = Field(default=0, ge=0, le=30000)
    failure: bool = False
    response_text: str = Field(default="这是本地测试模型的确定性回复。", max_length=2000)


class DemoConfigIn(BaseModel):
    expected_revision: int = Field(ge=0)
    value: DemoConfig


class DemoLog(BaseModel):
    time: str
    message: str


class DemoServiceOut(BaseModel):
    id: ServiceId
    ready: bool
    active_calls: int
    state: str
    logs: list[DemoLog]
    revision: int
    value: DemoConfig


class DemoActionIn(BaseModel):
    expected_revision: int = Field(ge=0)
    action: Literal["start", "stop", "reinitialize"]


class DemoInstallIn(BaseModel):
    expected_catalog_revision: int = Field(ge=0)


class DemoInstallOut(BaseModel):
    id: str
    message: str


class MockCompletionIn(BaseModel):
    model: str = "fpl-mock"
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    tool_choice: str | dict | None = None
    stream: bool = False
