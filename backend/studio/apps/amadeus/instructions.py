"""Validate input resources before the short instruction admission transaction."""

import asyncio

from studio.apps.amadeus.fork_references import project_reader
from studio.apps.amadeus.storage.files import open_work_file
from studio.runtime.database.operation_receipts import OperationError


async def validate_references(owner, conversation, references, root, read):
    can_read = project_reader(read)
    projects = set()
    for ref in references:
        if ref.target:
            key = ref.target.project_resource, ref.target.project_id
            if key not in projects:
                if not await can_read(*key):
                    raise OperationError("引用的项目不存在或无权读取", "reference_unavailable", 403)
                projects.add(key)
        elif ref.source == "imports" and ref.id == f"file:{ref.name}":

            def check_file(name=ref.name):
                file, _ = open_work_file(owner, conversation, "imports", name, files_root=root)
                file.close()

            await asyncio.to_thread(check_file)
        else:
            raise OperationError("补充消息中的引用无效，请重新引用", "invalid_reference", 422)
