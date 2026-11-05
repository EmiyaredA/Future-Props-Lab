class VideoEditorNotFoundError(Exception):
    pass


class VideoEditorValidationError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_timeline") -> None:
        super().__init__(message)
        self.code = code


class VideoEditorUnavailableError(Exception):
    pass
