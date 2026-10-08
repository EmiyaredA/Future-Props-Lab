"""Step verification. API revisions are observations, never assumed to be CAS."""

from copy import deepcopy

from .contracts import ExternalError


def clean_block(block):
    return {k: v for k, v in block.items() if k != "revision_id"}


def assert_snapshot(remote, expected):
    if remote.fingerprint != expected["fingerprint"] or remote.revision != expected["revision"]:
        raise ExternalError("目标内容发生变化，已暂停；请核对双方内容", 409, "remote_changed")


def assert_original_preserved(before, after, *, changed_ids=()):
    if before["title"] != after.title:
        raise ExternalError("目标文档标题发生变化", 409, "remote_changed")
    actual = {b["block_id"]: clean_block(b) for b in after.blocks}
    for block in before["blocks"]:
        id = block["block_id"]
        if id == before["document_id"] or id in changed_ids:
            continue
        if clean_block(block) != actual.get(id):
            raise ExternalError("目标正文有额外修改，已保留现场", 409, "remote_changed")


def verify_append(before, after, response, tree):
    relations = {
        r["temporary_block_id"]: r["block_id"] for r in response.get("block_id_relations", [])
    }
    if set(relations) != {b["block_id"] for b in tree["blocks"]}:
        raise ExternalError("飞书未返回完整内容块映射，需要核对", 409, "uncertain_write")
    roots = [relations[id] for id in tree["root_ids"]]
    if after.root_ids != before["root_ids"] + roots:
        raise ExternalError("内容块顺序发生变化，需要核对", 409, "remote_changed")
    assert_original_preserved(before, after)
    existing = {b["block_id"] for b in before["blocks"]}
    if {b["block_id"] for b in after.blocks} - existing != set(relations.values()):
        raise ExternalError("目标新增了额外内容，需要核对", 409, "remote_changed")
    actual = {b["block_id"]: b for b in after.blocks}
    for source in tree["blocks"]:
        block = actual[relations[source["block_id"]]]
        if block["block_type"] != source["block_type"]:
            raise ExternalError("写入内容类型与预览不一致", 409, "uncertain_write")
        if source.get("children") and block.get("children") != [
            relations[id] for id in source["children"]
        ]:
            raise ExternalError("表格内容结构与预览不一致", 409, "uncertain_write")
        for key, value in source.items():
            if key == "table":
                properties = block.get("table", {}).get("property", {})
                if any(properties.get(k) != v for k, v in value.get("property", {}).items()):
                    raise ExternalError("表格行列与预览不一致", 409, "uncertain_write")
            if isinstance(value, dict) and "elements" in value:
                if any(
                    block.get(key, {}).get("style", {}).get(k) != v
                    for k, v in value.get("style", {}).items()
                ):
                    raise ExternalError("内容块格式与预览不一致", 409, "uncertain_write")
                # Check all text and the requested inline formatting, allowing provider defaults.
                wanted = value["elements"]
                got = block.get(key, {}).get("elements", [])
                if len(wanted) != len(got):
                    raise ExternalError("正文写入结果与预览不一致", 409, "uncertain_write")
                for a, b in zip(wanted, got, strict=True):
                    if a["text_run"]["content"] != b.get("text_run", {}).get("content"):
                        raise ExternalError("正文写入结果与预览不一致", 409, "uncertain_write")
                    style = b.get("text_run", {}).get("text_element_style", {})
                    if any(
                        style.get(k) != v
                        for k, v in a["text_run"].get("text_element_style", {}).items()
                    ):
                        raise ExternalError("正文格式写入结果与预览不一致", 409, "uncertain_write")
    return {relations[id]: asset for id, asset in tree["images"].items()}


def verify_image(before, after, block_id, token):
    if before["root_ids"] != after.root_ids or {b["block_id"] for b in before["blocks"]} != {
        b["block_id"] for b in after.blocks
    }:
        raise ExternalError("图片写入期间目标结构变化", 409, "remote_changed")
    assert_original_preserved(before, after, changed_ids={block_id})
    image = next((b.get("image", {}) for b in after.blocks if b["block_id"] == block_id), {})
    if image.get("token") != token:
        raise ExternalError("图片写入结果不确定，需要核对", 409, "uncertain_write")


def verify_delete(before, after, old_ids):
    if after.root_ids != before["root_ids"][len(old_ids) :]:
        raise ExternalError("移除旧正文的结果不确定，需要核对", 409, "uncertain_write")
    blocks = {b["block_id"]: b for b in before["blocks"]}
    removed = set()

    def collect(id):
        removed.add(id)
        for child in blocks.get(id, {}).get("children", []):
            collect(child)

    for id in old_ids:
        collect(id)
    kept = deepcopy(before)
    kept["blocks"] = [b for b in before["blocks"] if b["block_id"] not in removed]
    assert_original_preserved(kept, after)
    if {b["block_id"] for b in after.blocks} != {b["block_id"] for b in kept["blocks"]}:
        raise ExternalError("目标含有额外内容，需要核对", 409, "remote_changed")
