# Agent Note: PPTX DrawingML 元素顺序兼容性

Status: implemented

## Problem

python-pptx 创建演示者备注时生成备注母版文件与关系，却未在 `presentation.xml` 写入
`p:notesMasterIdLst`。Keynote 拒绝导入整个文稿并提示文件格式无效，而 ZIP 完整性检查、
XSD 校验和 python-pptx 重新加载均不能发现该引用缺失。单页去除备注即可正常导入，
补齐备注母版登记后原 20 页文稿也能正常导入。

同类检查还发现带拐点连接线把 `a:custGeom` 追加到 `a:ln` 后面，违反
`CT_ShapeProperties` 的顺序；半透明 SVG 图片的 `a:alphaModFix` 位于 `a:extLst`
后面，违反 `CT_Blip` 要求扩展列表位于最后的规则。

## Decision

导出器在幻灯片列表前登记现有备注母版关系，不删除或栅格化备注。
连接线以原地替换预设几何的方式安装自定义路径，保留几何在变换后、描边前的位置。
图片透明度效果插入到 SVG 扩展列表之前。修复局限于演示工坊的 DrawingML 导出边界，
不修改文稿状态、数据库、API 或原生分组、连接关系与路径坐标。

## Alternatives considered

- **把整页栅格化**：可以避开原生对象格式问题，但会损失文本、形状和连接线的可编辑性。
- **导出后统一重排所有 XML**：可以修复顺序，但引入全包二次处理；在构造位置修正即可。
- **仅依赖 python-pptx 回读**：其解析容忍度较高，不能作为严格消费者兼容性的依据。
- **移除全部备注**：对照实验可以成功导入，但丢失用户内容；显式登记母版即可保留备注。

## Consequences

- 演示者备注显式引用唯一备注母版，原生连接线与透明矢量图满足对应 XML 元素顺序。
- 回归测试直接检查顺序，并验证路径坐标、描边、箭头、端点绑定、分组、标签与 PNG 回退。
- 测试不依赖本机安装的 Keynote；应用实际导入仍作为补充验证。

## Verification

- `uv run pytest -q tests/test_presentation_pptx_compatibility.py tests/test_presentation_scene.py tests/test_presentation_media.py tests/test_presentation_workshop.py`
- 使用本机 ISO/IEC 29500 PresentationML XSD 只读校验用户导出包：原文件有 17 处连接线
  几何顺序错误，修正后 20 页幻灯片均通过 schema 校验。
- Keynote 实际导入保留全部素材、备注和原生对象的修复包，确认成功打开并列出全部 20 页。
