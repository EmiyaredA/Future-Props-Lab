class VideoEditorNotFoundError(Exception):
    pass


class VideoEditorValidationError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_timeline") -> None:
        super().__init__(message)
        self.code = code


class VideoEditorUnavailableError(Exception):
    pass


class FrameRejected(Exception):
    """A renderer rejection whose existing HTTP mapping is owned by transport."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail
