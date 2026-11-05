"""Creative domain errors, independent of HTTP and storage."""


class CreativeError(Exception):
    def __init__(self, message: str, status: int = 422, code: str = "invalid_creative_item"):
        self.message = message
        self.status = status
        self.code = code
        super().__init__(message)


class CreativeFileError(ValueError):
    pass
