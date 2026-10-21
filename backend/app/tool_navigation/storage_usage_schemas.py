from pydantic import BaseModel, Field


class StorageDirectoryIn(BaseModel):
    directory: str = Field(min_length=1, max_length=4096)


class StorageShortcut(BaseModel):
    id: str
    label: str
    directory: str
    available: bool


class StorageAnalyzer(BaseModel):
    installed: bool
    version: str | None = None


class StorageCapacity(BaseModel):
    total_bytes: int
    used_bytes: int
    free_bytes: int


class StorageUsageState(BaseModel):
    analyzer: StorageAnalyzer
    directory: str
    capacity: StorageCapacity
    shortcuts: list[StorageShortcut]


class StorageOpenReceipt(BaseModel):
    directory: str
    submitted: bool = True
