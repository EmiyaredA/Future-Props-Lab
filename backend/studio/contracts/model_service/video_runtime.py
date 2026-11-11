"""Failure contract shared by the local video use case and its Metal adapter."""


class VideoRuntimeError(RuntimeError):
    pass


class VideoMemoryError(VideoRuntimeError):
    pass
