"""Mac-only allowlisted model file/MLX operations; never opens a service database."""

import asyncio
import shutil
from uuid import UUID

from studio.config.local_models import compatible, definition, manifest
from studio.contracts.model_service.model_native import (
    ActionRequest,
    ModelObservation,
    ModelsObservation,
    SpeechRequest,
)
from studio.host.local_models.files import owned_path
from studio.host.local_models.installer import Installer
from studio.host.local_models.runtime import LocalRuntime
from studio.runtime.files.signed_payloads import ModelOutputDescription


class ModelsControl:
    def __init__(
        self, state_root, models_root, *, installer=None, runtime=None, compatible_check=compatible
    ):
        for root in (state_root, models_root):
            if not root.is_absolute() or root.is_symlink():
                raise ValueError("模型 worker 必须使用明确且非链接的目录")
        state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root, self.models_root = state_root.resolve(), models_root.resolve()
        self.installer = installer or Installer(self.models_root)
        self.runtime = runtime or LocalRuntime(self.installer)
        self.compatible_check = compatible_check
        self.maintenance = asyncio.Lock()
        self.installations, self.progress = {}, {}
        self._command_revisions = {}

    def scratch(self, lease):
        root = owned_path(self.root, "jobs", str(UUID(str(lease.job_id))))
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        return root

    def output_path(self, lease):
        return owned_path(self.scratch(lease), "result.wav")

    async def installed(self, model_id):
        model = definition(model_id)
        owned_path(self.models_root, "models", model_id)
        return await asyncio.to_thread(self.installer.is_installed, model)

    async def observe(self):
        return ModelsObservation(
            compatible=self.compatible_check(),
            models=[
                ModelObservation(
                    model_id=model["id"],
                    installed=await self.installed(model["id"]),
                    loaded=self.runtime.model_id == model["id"]
                    and self.runtime.process is not None
                    and self.runtime.process.returncode is None,
                    busy=bool(self.runtime.busy),
                    installing=model["id"] in self.installations,
                    progress=self.progress.get(model["id"], 0),
                )
                for model in manifest()["models"]
            ],
        ).model_dump(mode="json")

    async def execute(self, lease, authorize):
        if not self.compatible_check():
            raise ValueError("原生模型仅支持 Apple Silicon Mac")
        await authorize()
        for part in ("models", "staging", "environments", "downloads"):
            owned_path(self.models_root, part)
        if lease.operation == "models.synthesize":
            request = SpeechRequest.model_validate(lease.payload)
            source = self.scratch(lease) / request.reference_filename
            output = self.output_path(lease)
            if source.is_symlink() or not source.is_file():
                raise ValueError("原生参考录音未传输完成")

            async def validate():
                await authorize()
                if not await self.installed(request.model_id):
                    raise ValueError("原生模型权重或环境不可用")

            values = {key: getattr(request, key) for key in ("text", "language", "reference_text")}
            values.update(reference_path=str(source), output_path=str(output))
            metrics = await self.runtime.synthesize(request.model_id, values, validate)
            description = await asyncio.to_thread(
                ModelOutputDescription.from_file, output, "result.wav", "audio/wav"
            )
            return {
                "output": {
                    "filename": description.filename,
                    "mime_type": description.mime_type,
                    "byte_size": description.byte_size,
                    "content_sha256": description.content_sha256,
                },
                "metrics": metrics,
            }
        request = ActionRequest.model_validate(lease.payload)
        if lease.operation != "models." + request.action:
            raise ValueError("原生操作与载荷不匹配")
        model_id = request.model_id
        if request.target_revision < self._command_revisions.get(model_id, 0):
            return {"installed": await self.installed(model_id)}
        self._command_revisions[model_id] = request.target_revision
        if request.action == "cancel":
            task = self.installations.get(model_id)
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            return {"installed": await self.installed(model_id)}
        async with self.maintenance, self.runtime.control:
            if request.target_revision != self._command_revisions[model_id]:
                return {"installed": await self.installed(model_id)}
            if self.runtime.busy:
                raise ValueError("本地模型仍在执行任务")
            if request.action in {"install", "repair"}:
                self.installations[model_id] = asyncio.current_task()
                self.runtime.maintenance = True
                self.progress[model_id] = 0
                try:
                    await self.runtime.close()

                    async def report(progress):
                        self.progress[model_id] = progress

                    await self.installer.install(
                        definition(model_id), report, repair=request.action == "repair"
                    )
                except asyncio.CancelledError:
                    return {"installed": await self.installed(model_id)}
                finally:
                    self.installations.pop(model_id, None)
                    self.runtime.maintenance = False
            elif request.action in {"stop", "uninstall"}:
                if self.runtime.model_id == model_id:
                    await self.runtime.close()
                if request.action == "uninstall":
                    for location in (
                        owned_path(self.models_root, "models", model_id),
                        owned_path(self.models_root, "staging", model_id),
                    ):
                        if location.is_symlink():
                            raise ValueError("模型目录不能是符号链接")
                        if location.exists():
                            await asyncio.to_thread(shutil.rmtree, location)
            elif request.action == "enable" and not await self.installed(model_id):
                raise ValueError("模型尚未安装")
        return {"installed": await self.installed(model_id)}

    async def cleanup(self, lease):
        root = self.scratch(lease)
        for name in (
            "reference.wav",
            "reference.mp3",
            "reference.m4a",
            "reference.ogg",
            "result.wav",
        ):
            path = owned_path(root, name)
            path.unlink(missing_ok=True)
        try:
            root.rmdir()
        except OSError:
            pass

    async def close(self):
        await self.runtime.close()
