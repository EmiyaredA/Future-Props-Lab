"""Do not expose previously recorded sensitive validation output through history."""


def safe_validation_catalog(catalog):
    sensitive_ids = {item.id for item in catalog.items if item.sensitive_result}
    recent = [
        check.model_copy(
            update={"summary": "敏感服务验证成功" if check.ok else "敏感服务验证失败，详情已隐藏"}
        )
        if check.resource_id in sensitive_ids
        else check
        for check in catalog.overview.recent
    ]
    items = [
        item.model_copy(update={"status_message": "敏感服务详情已隐藏"})
        if item.id in sensitive_ids and item.status_message
        else item
        for item in catalog.items
    ]
    return catalog.model_copy(
        update={"items": items, "overview": catalog.overview.model_copy(update={"recent": recent})}
    )
