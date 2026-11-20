"""Generation failures independent of HTTP and storage."""


class GenerationError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "generation_error",
        status: int = 422,
        current: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.current = current
