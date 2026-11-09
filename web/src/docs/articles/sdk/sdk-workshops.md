<!-- docs: {"group": "sdk-workshops", "category": "sdk", "order": 4, "title": "各工坊的自动化入口", "lead": "SDK 按业务模块提供方法，可以创建作品，也可以继续修改作品内部的对象。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 各工坊的自动化入口

SDK 按业务模块提供方法，可以创建作品，也可以继续修改作品内部的对象。

## 视觉与剧情

视觉操作使用 visual.apply_canvas_operations，实体包括 node 和 edge。删除节点会清理关联边；内容与生成草稿继续通过同一个画布校验。生成任务位于 generation 模块。项目对话和操作审批请使用 [Amadeus SDK](/docs.html?page=sdk-reference-amadeus)。

Galgame 使用 galgame.apply_story_operations，支持 character、scene、cg、variable、asset、chapter、fragment、block。fragment 的 parent_id 指向章节，block 的 parent_id 指向 Fragment；角色引用、分支和时间轴由 Story 总校验检查。章节或 Fragment 副本使用重新映射 ID 后的 insert 内容。

## 剪辑与演示

video 模块完整暴露已有时间轴 operations。裁剪、分割、变速、关键帧、转场和素材组织使用其现有类型化操作；expectedRevision 与 requestId 保持原接口语义。

presentation.apply_presentation_operations 支持 slide 与 element。元素通过 parent_id 定位页面；锁定元素先显式解锁。页面复制会为子元素生成确定的新 ID；图片引用使用公共文件库素材 ID。

## 文档与标注

thought.apply_note_operations 用内容树索引 path 定位保存版本内的节点；支持插入、替换、移除、同级移动、修改文本区间、标记和属性。文本范围使用 Python 字符索引；每批开始前校验文档 revision。

annotation.apply_annotation_operations 支持 speaker、segment，以及 split 和 merge_next。拆分保留左段文本，右段清空文本与翻译；合并沿用当前网页规则，拼接原文并清空翻译，结果标记为待校对。

## 查找具体方法

模块参考从服务端契约生成，列出方法、HTTP 路径和必填参数。完整文档构建可使用 builders 中的 presentation_document、note_document 和 text_node，然后经正式创建或保存接口提交。
