# 分层桌宠资源包

通过桌宠工坊「导入角色资源包」上传本地 ZIP；接口沿用 `POST /v1/desktop-pet/projects/import-whale`。此格式只保存数据，不接受 JavaScript、未登记文件、软链接或逃逸路径。

## 清单与兼容

`manifest.json` 固定为 `{"format":"fpl-coopanion-whale","version":1}`。`model.json` 缺省 `rigProfile` 为 `whale`；原 Coopanion 模型定义保持不变。人物模型使用 `human-chibi`，不要求裙子、尾巴或鱼鳍。

人物模型的 `character` 必须有非空 `name`，最多 120 字；可选 `persona` 使用角色配置已有的 `description`、`personality`、`speakingStyle` 和 `greeting` 字段。导入不会修改其他项目，首套配色作为默认。人物私人聊天默认关闭主动台词，之后由各账号自行保存偏好。

## 人物骨架

坐标采用桌宠行为引擎的空间，足底 `y=256`，身体中心 `x=128`。保留 `units.S`、`units.X0`、`units.FEET` 的数值字段；人物分件与五官直接采用骨架空间，不做鲸鱼娘原画像素转换。

- `view`：`[x0,y0,x1,y1]`，宽高为正且各不超过 512；推荐 `[0,-8,256,280]`。
- `pivots`：`body`、`neck`、`armNear`、`armFar`、`legBack`、`legFront` 各有二维坐标。
- `parts`：每件有唯一 `id`、`tex`、`z`、`parent`、`box=[x,y,width,height]` 和 `grid=[columns,rows]`。贴图为 `tex/{tex}.png`，宽高为正，网格每轴 1–16。
- 必需部件：`hair_back`、`hair_front`、`face`、`torso`、`coat`、`arm_near`、`arm_far`、`leg_back`、`leg_front`、`sit_lower`。
- 允许父变形器：`body`、`neck`、`head`、`hair`、`bangs`、`coat`、`armNear`、`armFar`、`legBack`、`legFront`。头部用 `head`，长发用 `hair`，前发用 `bangs`，外套用 `coat`，四肢用对应变形器。

`face` 是不带五官的皮肤底画。动态五官在 z=8、parent=head 的层绘制；脸底应在其下，前发在其上。关节、皮肤与衣物需要完整隐藏补画。`sit_lower` 替换站立双腿；行为引擎坐姿下降 29 单位，人物适配抵消其中 11 单位，因此完全坐下时该部件静态底边设为 `y=238`。

## 五官与配色

`feat.sprites` 使用 `[x0,y0,x1,y1]` 标记每张五官的骨架位置；对应贴图为 `feat/{name}.png`。必需：`eyes`、`closed_eyes`、`angry_eyes`、`surprised_eyes`、`brows`、`neutral_mouth`、`happy_mouth`。眼睛贴图包含两眼，不包含独立眉毛；眉毛单独绘制。无需鲸鱼娘的 `feat.eyes`。

`schemes` 为 1–8 套，每套唯一 `id`，可提供 `brand`、`label` 和 `accent`。第一套素材直接放在 `tex/`、`feat/`；后续配色放在 `schemes/{id}/tex/` 与 `schemes/{id}/feat/`，同名 PNG 尺寸必须一致。每套必须有 `thumbs/{id}.png`。

资源包仅含清单、模型与模型登记的 PNG。ZIP 最多 32 MiB、解压最多 64 MiB、文件最多 450 个；每张 PNG 最多 16 MiB、每轴最多 4096。导入经过 Workspace 权限和完整校验，素材随后通过鉴权 API 加载。
