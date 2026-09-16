# 全站前端屏幕适配验收

日期：2026-09-08 至 2026-09-09。保留各应用桌面视觉，本轮只修改前端布局、控件、测试与说明；已有后端、迁移及契约工作保留，不属于本轮改动。

## 适配规则与修复

- 主控制台和普通工坊使用单实例侧栏：桌面显示完整导航，1200px 以下转为抽屉；侧栏背景列随页面延伸，导航及主题区按可见视口布局。思绪工坊继续使用旧版品牌、返回卡片、图标与暖橙选中态。
- 共用选择器默认进入浏览器顶层显示，仍使用项目自绘外观；根据可见视口空间向上/向下展开。账号弹窗从侧栏移到页面顶层，修正层级遮挡；抽屉和弹窗支持 Esc、Tab 范围和关闭后的焦点恢复。
- `VisualViewport` 高度与偏移参与弹窗、菜单和编辑面板约束；短横屏不再依赖桌面固定高度。根页面不增加横向溢出隐藏。
- 视频移除 1160px 最小宽度，预览/素材/属性可切换，时间线局部滚动。Galgame 剧本/结构/预览与角色列表/详情分面板显示，移除角色区 1030px 最小宽度，修正横屏顶部换行遮挡工作区导航。
- 录音标注分为波形与片段、编辑片段；操作区和缩放工具换行。模型生成、识别、实时语音分为结果、参数资源、历史面板，文本对话仍使用对话与参数抽屉。切换尺寸使用 CSS 调整可见性，业务编辑器与控制器保持挂载。
- 视觉画布恢复手机素材入口，增加可点击的添加内容菜单，提供键盘选择与焦点恢复；已有平移模式、缩放、适配视图和节点菜单保留。
- 修复录音项目、模型目录、测试工具及视频任务请求失败时被当作空列表的问题，展示明确错误和重试入口。
- 截图复核补充修正 Galgame/录音项目手机单列、预演检查器被隐藏、预演浅色主题对比度，以及延迟加载导出样式覆盖手机宽度约束。卡片用例增加实际宽度断言，截图等待懒加载内容完成，防止把加载占位误当成最终页面。
- 原有旅程回归补充修正画布视图控制挡住图片参数入口：展开节点生成面板时重新安排视图控制，手机关闭面板后恢复画布控制。Galgame 移除旧结构抽屉状态、遮罩及旧版堆叠样式，结构入口统一切换当前面板；对应旅程改为验证当前面板可见、内容宽度及预演能力。
- 清理旧布局后再次检查实际截图，修正 Galgame 平板目录的排列方向、手机舞台预览高度和长项目名的顶部约束；增加目录纵向顺序与舞台最小高度断言，并重新执行编辑器的八尺寸明暗矩阵。

## 页面与面板覆盖清单

`web/e2e/responsive-inventory.ts` 为应用路由提供穷尽归属；新增路由或 HTML 入口未登记会使 Web 覆盖测试失败。完整矩阵包括 360×640、390×844、768×1024、1024×768、1280×800、1600×1000、1920×1080、844×390，每种尺寸检查明暗主题。

| 页面或模板 | 覆盖内容 | 用例 |
| --- | --- | --- |
| 主控制台、应用中心、工具导航 | 入口卡片、导航抽屉、长页背景 | responsive-site / responsive-panels |
| 文件管理 | 卡片/筛选、加载、失败、长提示 | responsive-site / responsive-states |
| 工具 API、MCP、Skill | 三种列表、加载、失败、长提示 | responsive-site / responsive-states |
| 视频取帧 | 独立工具入口、文件选择区域 | responsive-site；现有取帧回归 |
| 录音标注 | 项目列表、波形、片段检查器、操作区、失败 | responsive-editors / responsive-states |
| 模型服务、调用日志、测试工具 | 列表、筛选、加载、失败、长提示 | responsive-site / responsive-states |
| 模型测试 | 文本、图像、视频、识别、实时语音及小屏子面板；目录为确定性模拟 | responsive-panels；base-model-ui |
| 视觉工坊 | 项目、任务、画布、素材管理；添加菜单、草稿与挂载状态 | responsive-site / responsive-editors |
| 视频工坊 | 项目、任务、编辑器预览/素材/属性、局部时间线 | responsive-site / responsive-editors；video-editor-layout |
| Galgame | 项目、概览、编辑、预览、剧本/结构/预览；独立预演的舞台/台词队列/检查与编辑；角色、场景、BGM、音效、语音、视频、资源总览、叙事地图、个性化、设置 | responsive-site / responsive-editors |
| 思绪工坊 | 卡片、空首页、长首页、富文本编辑、单侧栏与主题区、目录、旧链接、附件与菜单 | responsive-editors；thought-layout / knowledge / attachments / dialogs |
| 账号与 Workspace | 资料、安全与密钥、账号治理、空间、成员与邀请；小屏焦点恢复 | responsive-panels |
| 登录、公开展示 | 登录表单、公开空状态、长空间名 | responsive-panels |
| 文档中心 | 独立 docs.html 入口、阅读、搜索、历史、主题 | responsive-site；docs |

远程列表另行使用延迟与 503 响应覆盖加载及错误，不调用真实模型，不向用户项目插入测试内容。编辑器测试数据通过正式 API 创建于隔离临时数据库。

表单矩阵另覆盖文件夹操作、供应商表单、测试工具向导、工具 API、MCP、Skill 上传，以及嵌套选择菜单。关闭菜单不会误关父弹窗；退出弹窗后返回原触发入口。

表单焦点恢复使用键盘打开路径验证；WebKit 的鼠标点击默认不会聚焦按钮，导航与文档图片入口已显式捕获焦点。弹窗也处理指针切换页签后焦点落在 body 的情况，仅由最上层弹窗响应 Esc，避免误关底层抽屉。

## 复现方式

- 全量尺寸：运行 `responsive-site`、`responsive-editors`、`responsive-forms`、`responsive-panels` 与 `responsive-states` 浏览器用例。
- 设置 `FPL_RESPONSIVE_SCAN=1` 时仅检查 360×640 与 1280×800，用于跨浏览器核心回归；不能把此模式记录为八尺寸矩阵。
- `FPL_E2E_BROWSER=webkit|firefox` 选择其他浏览器，`FPL_E2E_OUTPUT` 指定独立截图目录。测试服务使用独立端口和临时数据库，禁止复用用户运行中的数据库。
- 不同时启动两份浏览器测试；认证初始化使用同一临时状态文件。全量 Web 测试与大量截图分开执行，避免机器负载导致编辑器测试超时。

## 验证记录

Chromium 最终完整矩阵 25 项通过，包含 1,750 张截图（浅色、深色各 875 张）；八种视口均有覆盖。WebKit 与 Firefox 的核心检查经过修复后通过，包括表单键盘打开、菜单、导航焦点、账号、文档中心、五类模型测试及各编辑工作区。跨浏览器矩阵使用 360×640 与 1280×800，不计作八尺寸全矩阵。

截图按页面、尺寸、主题命名，基准矩阵保存在 `.local/output/responsive/delivery/`，最新编辑器复测保存在 `.local/output/responsive/geometry-final/`，属于本地验收输出，不作为产品资产发布。可打开 [截图筛选索引](../../.local/output/responsive/index.html) 搜索页面并查看原图；[完整图片清单](../../.local/output/responsive/manifest.json) 可用于核对覆盖。索引按页面、尺寸、主题和面板去重，使用最终 Chromium 成功运行的截图，修复前的失败截图不混入交付索引。思绪工坊原验收目录中的长首页截图也已替换。

截图复核包含各页面模板的手机缩略总览，以及桌面、横屏、明暗主题下的关键工作区、长首页与弹窗原图；没有声称人工逐张审阅全部 1,750 张图片。自动化检查页面溢出和可见弹层边界，交互用例检查导航入口、焦点恢复、面板切换与局部操作；不以截图数量代替交互验证。

浏览器修改视口与模拟指针仅证明自动化浏览器环境的行为。当前环境没有连接实体手机，实际 iOS/Android 软键盘、刘海安全区、系统缩放及硬件触控手势仍需真机验收；不得把视口缩放等同于这项验证。

已有且未触及的两项尺寸检查失败：`web/src/features/visual-workshop/styles/project-library-foundation.css` 607 行、`web/tests/visual-workshop-canvas.test.tsx` 1418 行。未增加任何尺寸豁免。

### 检查结果与日志

| 检查 | 结果 | 记录 |
| --- | --- | --- |
| 全量 Web 测试 | 105 个文件、565 项通过 | [全量日志](../../.local/output/responsive/checks/web.log) |
| 收尾组件回归 | 4 个文件、26 项通过，包含 Galgame 编辑、创作、角色预设和可见视口测试 | [组件日志](../../.local/output/responsive/checks/focused-web.log) |
| Chromium 完整矩阵 | 25 项通过；最后的编辑器几何修正另行通过八尺寸明暗复测 | [全站矩阵](../../.local/output/responsive/checks/matrix.log)、[编辑器复测](../../.local/output/responsive/checks/geometry-final.log) |
| WebKit / Firefox | 核心回归及修复后的针对性复测通过 | [WebKit 收尾](../../.local/output/responsive/checks/final-webkit.log)、[Firefox 收尾](../../.local/output/responsive/checks/final-firefox.log) |
| 原有业务旅程 | 思绪工坊、模型、工具、文档、视频、画布和 Galgame 相关用例经过针对性修正后通过 | [核心旅程](../../.local/output/responsive/checks/core.log)、[思绪工坊等旅程](../../.local/output/responsive/checks/confirmed.log)、[分支与文档收尾](../../.local/output/responsive/checks/final-journey.log) |
| lint / 格式 / 契约检查 | 通过 | [lint](../../.local/output/responsive/checks/lint.log)、[格式](../../.local/output/responsive/checks/format.log)、[契约](../../.local/output/responsive/checks/contracts.log) |
| 架构检查 | 34 项通过；上述两项已有文件超限失败 | [架构日志](../../.local/output/responsive/checks/architecture.log) |
| 生产构建 | 通过，包括资源校验、类型检查、打包和产物大小检查 | [构建日志](../../.local/output/responsive/checks/build.log) |

全量 Web 运行后，收尾修改采用受影响组件和浏览器旅程复测。日志分别保留，不将多次针对性运行描述为一次全量运行；不修改产物预算或增加文件尺寸豁免来通过检查。
