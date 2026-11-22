"""Register an uploaded project image without splitting card and membership writes."""

from studio.runtime.project_errors import ProjectResourceError


class ReferenceImages:
    def __init__(self, records, inspect_assets, inspect_identity):
        self.records = records
        self.inspect_assets, self.inspect_identity = inspect_assets, inspect_identity

    async def register(self, project, body):
        await self.records.require_project(project)
        found = await self.inspect_assets(project, {body.asset_id})
        image = found.get(body.asset_id)
        if image is None or image.media_kind != "image":
            raise ProjectResourceError("请选择当前项目的图片", "reference_image_project_scope", 422)
        identity = await self.inspect_identity(project, body.asset_id)
        if identity is None:
            raise ProjectResourceError(
                "图片原件暂不可读，请重试", "reference_image_unavailable", 503
            )
        return await self.records.register(project, body, identity)
