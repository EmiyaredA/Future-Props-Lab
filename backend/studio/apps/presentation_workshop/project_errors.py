"""Project-level presentation errors shared by HTTP and storage bindings."""


class PresentationError(Exception):
    def __init__(self, message: str, status: int = 422, code: str = "invalid_presentation"):
        super().__init__(message)
        self.status, self.code = status, code
