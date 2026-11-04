"""Call the selected annotation transcription binding without sharing provider state."""


async def transcribe(session, project_id, **kwargs):
    return await session.info["annotation_transcribe"](session, project_id, **kwargs)
