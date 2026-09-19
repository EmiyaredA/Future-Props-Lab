# Agent Note: 导演台作为独立 App 迁入

Status: proposed

## Problem

导演台是三维预演工具，场景语义依赖已加载的 WebGL。若把工程 JSON、二进制和改场景工具拆进现有视频剪辑、Galgame 或视觉工坊，文档模型和运行时都会错位。若在迁入时先做跨应用总控助手，又会把尚未落地的宿主和 1.8 万行编辑器绑在一起。

## Proposal

导演台是新 App `director-desk`。编辑器进程是场景的唯一写入方；服务端只保存它校验后的瘦 JSON，并用 CAS 拒绝过期写入。模型、贴图和视频放进本 App 的项目素材根，不进入 SQLite，也不给共享 `VisualAsset` 增加外键。

助手只拥有导演台工具契约和编辑器内面板，不新建助手会话表，不并进视觉助手。`fpl` 白名单在助手可用之后再登记同一套命令；工程未打开则拒绝。不移植导演台自己的 Electron 与 MCP。

当前已挂上上游三维编辑器。服务端保存编辑器写出的瘦 JSON，并用 CAS 拒绝过期写入；内嵌二进制会被拒绝。模型、贴图和视频以 SHA-256 放在项目目录 `applications/director-desk/projects/{id}/files/`，用户动作库元数据在 `director_desk_user_motions`，模型包在 `applications/director-desk/library/`。编辑器内存仍使用内嵌字节，只在保存和打开时转换。`.director` 的打包和解包在浏览器完成。助手和 `fpl` 白名单还没做。

## Alternatives considered

- **把模型字节放进共享 VisualAsset** — 能复用现有上传，但要给共享表加第四个互斥外键；导演台资源不是图库素材。
- **把三维场景映射进视频剪辑时间轴或 Galgame Story** — 能复用现有项目壳，但两边的时间、镜头和素材都不是同一份数据，后续只能再拆。
- **先做跨应用总控助手，再让导演台接入** — 总控宿主还不存在；导演台改场景必须在打开的 WebGL 里执行，等宿主会挡住编辑器迁入。
- **复制视觉助手的会话表** — 对话能先持久化，但会变成第三套助手存储，以后并进总控时要再迁。

## Acceptance criteria

- 应用中心可以打开导演台，列出、新建和删除当前 Workspace 的项目。
- 缺 revision 的改名返回 422，过期 revision 返回 409，跨 Workspace 的项目 ID 按不存在处理。
- 服务端接受编辑器瘦 JSON，拒绝内嵌二进制；文件以 SHA-256 留在项目目录。
- 未把导演台操作登记进 `fpl` 白名单。

## Risks

- 大文件仍由浏览器拆包和上传，服务端不解析场景。助手和 `fpl` 仍未接入。
