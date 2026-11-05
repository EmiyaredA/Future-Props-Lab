"""File-operation errors shared by protocol adapters, without ORM or storage state."""


class AssetError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "asset_error",
        status: int = 422,
        detail: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.detail = detail or {}
