from pydantic import BaseModel, Field


class DesktopSetupOut(BaseModel):
    setup_required: bool


class DesktopSetupIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(default="", max_length=128)
    password: str = Field(min_length=10, max_length=128, repr=False)
