from __future__ import annotations

import asyncio
import io
import json
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select, update

from app.apps.live2d_workshop.models import Live2DExport
from app.apps.live2d_workshop.projects import Live2DProjectsStore
from app.apps.live2d_workshop.schemas import Live2DExportIn
from app.capabilities.media_rendering.live2d.document import CharacterDocument
from app.capabilities.media_rendering.live2d.render import render_frame
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner


class Live2DExportRunner(PollingTaskRunner):
    runner_name = "live2d-export"
    poll_interval_seconds = 0.5

    def __init__(self, session_factory=SessionLocal) -> None:
        super().__init__()
        self.sessions = session_factory

    async def recover(self) -> None:
        async with self.sessions() as session:
            await session.execute(
                update(Live2DExport)
                .where(Live2DExport.status == "running")
                .values(status="failed", error="导出因应用退出而中断，请重新发起")
            )
            await session.commit()

    async def set_status(self, task_id: str, **values) -> None:
        async with self.sessions() as session:
            await session.execute(
                update(Live2DExport).where(Live2DExport.id == task_id).values(**values)
            )
            await session.commit()

    async def cancelled(self, task_id: str) -> bool:
        async with self.sessions() as session:
            task = await session.get(Live2DExport, task_id)
            return task is None or task.cancel_requested

    async def process_once(self) -> None:
        async with self.sessions() as session:
            task = await session.scalar(
                select(Live2DExport)
                .where(Live2DExport.status == "queued")
                .order_by(Live2DExport.created_at)
            )
            if task is None:
                return
            task_id, project_id, workspace_id = task.id, task.project_id, task.workspace_id
            claimed = await session.execute(
                update(Live2DExport)
                .where(
                    Live2DExport.id == task_id,
                    Live2DExport.status == "queued",
                    Live2DExport.cancel_requested.is_(False),
                )
                .values(status="running")
            )
            if claimed.rowcount != 1:
                await session.rollback()
                return
            snapshot, payload = task.snapshot, task.payload
            await session.commit()
        try:
            doc = CharacterDocument.model_validate(snapshot)
            body = Live2DExportIn.model_validate(payload)
            async with self.sessions() as session:
                store = Live2DProjectsStore(session, workspace_id)
                paths = await store.paths(project_id)
                root = store.root(project_id)
            with TemporaryDirectory(prefix="fpl-character-export-") as temp:
                output = Path(temp) / "frames.zip"
                manifest = []
                total = (body.end_frame - body.start_frame) * len(body.combinations)
                finished = 0
                with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                    for index, pair in enumerate(body.combinations):
                        motion = next((m for m in doc.motions if m.id == pair.motion_id), None)
                        expression = next(
                            (e for e in doc.expressions if e.id == pair.expression_id), None
                        )
                        folder = (
                            f"{index + 1:02d}_{pair.expression_id or 'default'}_"
                            f"{pair.motion_id or 'still'}"
                        )
                        manifest.append(
                            {
                                "folder": folder,
                                "expression": expression.name if expression else None,
                                "motion": motion.name if motion else None,
                                "fps": body.fps,
                                "startFrame": body.start_frame,
                                "endFrame": body.end_frame,
                            }
                        )
                        for frame in range(body.start_frame, body.end_frame):
                            if await self.cancelled(task_id):
                                await self.set_status(task_id, status="cancelled")
                                return
                            crop = body.crop
                            image = await asyncio.to_thread(
                                render_frame,
                                doc,
                                paths,
                                frame=frame * (motion.fps if motion else body.fps) / body.fps,
                                motion_id=pair.motion_id,
                                expression_id=pair.expression_id,
                                width=body.width,
                                height=body.height,
                                crop=(crop.x, crop.y, crop.width, crop.height) if crop else None,
                            )
                            payload = io.BytesIO()
                            await asyncio.to_thread(image.save, payload, format="PNG")
                            archive.writestr(
                                f"{folder}/{frame - body.start_frame:05d}.png", payload.getvalue()
                            )
                            finished += 1
                            await self.set_status(task_id, progress=round(finished * 100 / total))
                    archive.writestr(
                        "manifest.json",
                        json.dumps(
                            {"format": "png-sequence", "combinations": manifest}, ensure_ascii=False
                        ),
                    )
                if await self.cancelled(task_id):
                    await self.set_status(task_id, status="cancelled")
                    return
                destination = root / "exports" / f"{task_id}.zip"
                destination.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(destination.write_bytes, output.read_bytes())
                async with self.sessions() as session:
                    result = await session.execute(
                        update(Live2DExport)
                        .where(
                            Live2DExport.id == task_id,
                            Live2DExport.status == "running",
                            Live2DExport.cancel_requested.is_(False),
                        )
                        .values(status="completed", progress=100)
                    )
                    await session.commit()
                if result.rowcount != 1:
                    destination.unlink(missing_ok=True)
                    await self.set_status(task_id, status="cancelled")
        except asyncio.CancelledError:
            await self.set_status(task_id, status="failed", error="导出中断，请重新发起")
            raise
        except Exception as exc:
            await self.set_status(task_id, status="failed", error=str(exc)[:500])
