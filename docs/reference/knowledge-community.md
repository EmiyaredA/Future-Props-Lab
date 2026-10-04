# 知识社区 API 与数据边界

知识社区面向同一部署中的登录账号，前缀为 `/v1/thought-workshop/community`。只接受浏览器 Session；写请求沿用 CSRF Cookie 与请求头校验。Management API Key、桌面 Agent、匿名访问均不开放。业务客户端不提交 Workspace ID。

## 发布与逐篇授权

发布记录保存源 Workspace、知识库、发布者、社区名称、简介、封面、启用状态、`is_official`、`read_only`、`editable_platform_roles` 和 revision。新建默认非官方、只读、无角色授权。只有平台角色 super_admin/admin 可以改变官方标记或角色编辑授权；普通正文“官方”标签不产生认证徽标。文章配置保存可见范围、启用状态及独立 revision；成员按准确账号名授权 read/edit/manage。首次发布、增选文章、知识库信息及整库撤回仅由源 Workspace 管理者执行。逐篇 manage 只允许设置获授权文章的范围、角色和发布状态。

| 接口                                                           | 行为与授权                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /publications`                                            | 按 query、mine、favorites 及可选 official 布尔筛选分页；只检索可读文章，返回实际可访问计数、作者、更新时间、收藏和管理能力 |
| `GET/PUT /libraries/{library_id}/publication`                  | 当前 Workspace 管理者查看或首次设置发布，PUT 要求发布 expected_revision 与各文章 expected_revision                         |
| `GET/PUT /publications/{publication_id}/management`            | 源 Workspace 管理者跨当前空间管理整个发布；GET 提供源目录与配置，PUT 复用发布校验                                          |
| `GET /publications/{publication_id}`                           | 返回过滤目录及各文章 role、can_edit、can_manage；隐藏父文档的子项提升到可见层级                                            |
| `GET/PUT /publications/{publication_id}/notes/{note_id}`       | 读取当前正文或按 edit/manage 保存标题、正文、标签、schema_version；PUT 必须携带正文 expected_revision                      |
| `GET/PUT /publications/{publication_id}/permissions`           | GET 使用重复 note_id 参数，逐篇 manage 检查；PUT 原子批量设置 articles，逐项 CAS                                           |
| `GET /publications/{publication_id}/notes/{note_id}/backlinks` | 只返回同一发布内可读的反向引用，支持 offset/limit                                                                          |
| `GET /publications/{publication_id}/assets/{asset_id}/content` | 只开放可读正文实际引用素材；可选 note_id 限定当前文章及本账号为该文章上传的待保存素材                                      |
| `GET /publications/{publication_id}/cover`                     | 明确发布的封面，仅限能访问该发布的账号                                                                                     |
| `POST /publications/{publication_id}/notes/{note_id}/uploads`  | edit/manage 通过后上传到源空间，落盘后再次授权再登记；不开放源文件库搜索                                                   |
| `GET /publications/{publication_id}/export-snapshot`           | 当前可读正文、可见目录和实际引用素材的统一读快照，不包含历史、私人目录或回收站                                             |
| `GET /favorites`                                               | 仅当前账号收藏资源 ID                                                                                                      |
| `PUT /favorites/{namespace}/{resource_id}`                     | namespace 为 community 或 official，正文为 favorite 布尔值；新增社区收藏先校验可访问，移除仅修改本人记录                   |

缺少 revision 或无效正文返回 422，版本冲突返回 409 和当前快照，文章不存在、未发布、回收站或未获所需角色统一返回 404。客户端不自动覆盖或重试。文章和权限 revision 相互独立，批量中任一校验或冲突失败，整批回滚。

## 原文、事务与恢复

正文继续保存在原 ThoughtNote，社区不创建副本。网关在独立会话中先验证发布、源项目及逐篇角色，再绑定源 Workspace 调用 Notes，保留原有内容校验、短事务、CAS 与历史。读取使用明确 SQLite 读事务；保存和权限变更使用 BEGIN IMMEDIATE，使授权检查与撤销串行化，不把文件 I/O 放进写事务。

当前正文、发布属性、源成员权限、逐篇授权及编辑角色共同决定社区能力；只读发布不继承源普通成员的编辑权，发布者及源管理者保留维护权限。角色编辑授权仅作用于已可见文章，不授予管理能力。跨空间平台管理员以编辑角色访问，不因该角色授权自动成为源管理者；明确进入源 Workspace 后仍遵守平台治理权限。逐篇角色不开放源空间的其他内容。保留原文现有引用可继续编辑，新引入的文档引用必须在当前发布中可读，新素材必须已被当前正文使用或由该账号为该篇上传。社区无历史接口，原 Workspace 的历史查看与恢复保持原用例。

回收站操作在源事务中关闭文章发布；恢复不自动重新发布。整库撤回保留正文及配置，只有源管理者能重新开放。更改源知识库封面不会悄悄更改已发布封面，保存发布设置时更新；公共文件删除保护同时检查发布封面引用（包括撤回配置）。

普通笔记、文件与目录 API 不放宽跨空间检查。导入后的官方与普通文章使用同一富文本阅读器，DocumentAccess 显式适配保存、素材、上传、粘贴、引用、反向链接和导出。社区草稿、缓存、收藏和阅读位置按账号、发布及文章隔离；原笔记恢复键不变。授权失效保留未提交草稿并停止保存，可保留本机草稿后离开。

## 迁移与交付

追加 `0082_thought_publications` 建立五张发布表，不迁移正文、不自动发布任何旧文章。迁移在临时数据库验证后定稿；正式数据升级走停机备份与正式迁移入口，桌面热加载遇到未应用迁移会阻止启动/更新。

追加 `0084_unified_official_publications` 保存发布属性、导入来源映射及持久化回执。已有发布默认非官方、非只读、无角色授权，保留行为。管理员主动导入包包含 12 个库、93 篇文章及 12 篇首页；数据库 ID 统一新建与重映射，旧 URL、引用和收藏按来源映射解析当前可访问的官方发布。应用升级不覆盖已导入笔记，不存在静态阅读回退。社区发布配置不写入普通知识库备份；导入的新副本默认未发布，需要目标管理者重新授权。

社区契约同步到 OpenAPI 和 Web 生成类型。Python SDK 和 Agent 白名单不注册社区操作；适用的 SDK 公共用例保持现有契约。受保护的原文档中心保持不变。

## 显式导入与旧链接

| 接口                                                 | 行为                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /official-import/preview`                       | 平台管理员及当前空间写权限；返回包 SHA-256、库／文章／图形数量与标题，不写入                                                           |
| `POST /official-import`                              | 输入 request_id 与 package_version；复用普通备份事务创建私人笔记；成功回执、来源映射与正文原子提交                                     |
| `GET /official-import/{request_id}`                  | 只读取当前 Workspace、当前操作者的成功回执；中断恢复先查询，404 后可使用同一请求重试                                                   |
| `GET /official-links/{library_key}?document_key=...` | 仅返回已发布、官方、当前可访问的映射；唯一跳转、多项选择、空结果提示；不返回私人标题                                                   |
| `POST /publications/{publication_id}/references`     | ids 最多 100 个；先验证当前发布可访问，再逐篇解析同一源空间的已发布目标，返回 publication_id 供跨库跳转；不可见项只有 unavailable 字段 |

同一成功 request_id 重放返回原结果，即使升级已改变包版本。将同一 ID 用于另一版本返回 409；主动再次导入使用新 ID，不覆盖旧笔记。来源包保留标准提示块、代码、Mermaid、CanvasScene、首页和相关阅读；包生成与校验不操作数据库。普通备份仍不包含发布权限或官方认证，导入副本需要重新授权。
