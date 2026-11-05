"""Apply an approved timeline batch through Video's existing versioned receipt."""

from studio.apps.amadeus.clients.website_operations import RegisteredRevisionConflict

from .operation_calls import call_registered


def operation_results(operations, status):
    return [
        {"index": index, "type": operation.get("type"), "status": status}
        for index, operation in enumerate(operations, start=1)
        if isinstance(operation, dict)
    ]


async def apply_video_batch(capabilities, assertion, path, action):
    args = action.arguments
    operations = args.get("operations")
    try:
        outcome = await call_registered(
            capabilities,
            assertion,
            path,
            "video.apply_timeline_operations",
            {
                "path_params": {"project_id": args.get("project_id", "")},
                "body": {
                    "expectedRevision": args.get("expected_revision"),
                    "requestId": action.id,
                    "operations": operations,
                },
            },
            approved=True,
        )
    except RegisteredRevisionConflict as exc:
        return "failed", {
            "code": "revision_conflict",
            "message": "资源版本冲突，未覆盖现有数据",
            "current": exc.current,
            "operationResults": operation_results(operations, "not_executed"),
        }
    return "completed", {
        **outcome["result"],
        "operationResults": operation_results(operations, "completed"),
    }
