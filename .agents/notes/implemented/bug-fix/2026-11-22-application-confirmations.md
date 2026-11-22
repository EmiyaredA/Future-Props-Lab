# Agent Note：业务确认统一使用自绘弹窗

Status: implemented

## Problem

设定卡的关闭、舍弃草稿及白模预演的离开、冲突恢复仍有四处使用浏览器同步确认框。默认外观与项目不一致，也阻塞页面交互。卡片编辑器位于原生模态 dialog 的顶层，直接把共享确认框挂到 body 会让它处于不可交互的模态区域外。

## Decision

四处操作复用共享 ConfirmDialog，并通过 useConfirmation 等待布尔结果。取消保留原草稿或待交付批次，确认后才继续关闭、保存或载入。未决选择不被第二个操作替换；组件卸载以取消结束等待，避免离开后继续执行陈旧动作。

ConfirmDialog 接收可选的显式 portal 容器；卡片编辑器传入自身 dialog，其他现有调用默认使用 body。保留共享主题、焦点约束、焦点恢复、Escape 与进行中禁止关闭的规则。场景导航等待确认时，父级 leaving 标记不禁用选择按钮，避免等待闭环无法完成；实际保存或交付进行中仍禁止确认。服务器版本读取期间锁定场景并沿用原有失败反馈。

Web ESLint 启用 no-alert，禁止新增浏览器 alert、confirm、prompt 调用；本地具名业务函数不受影响。浏览器刷新和关闭标签页的 beforeunload 仍保留未保存保护，这种浏览器退出流程无法用异步自绘确认框替代。

## Alternatives considered

仅替换卡片关闭会遗漏同类恢复与离开操作。共享确认框仍挂 body 会被已有模态 dialog 隔离。移除退出保护虽然消除了浏览器离开提示，却会丢失既有防止未保存内容意外丢失的能力。

## Consequences

不修改后端、持久数据或项目路由。确认流程变为异步，依赖关闭结果的场景跳转显式等待；确认框的挂载位置与忙碌状态由调用方提供。后续业务弹窗遵循[开发与验证流程](../../../../docs/operations/development-workflow.md#验证矩阵)，共享职责见[目录索引](../../../../docs/architecture/project-layout.md#兼容网站与组件端口)。

## Verification

全仓库搜索排除业务方法及安全测试字符串后，仅发现并替换这四处主动浏览器弹窗。单元验证确认／取消、焦点恢复、重复请求、卸载取消、忙碌状态、场景冲突恢复及待发送批次离开；浏览器旅程检查嵌套模态里的可见性、键盘取消、保留草稿和载入已保存版本，并记录原生 dialog 事件应为空。

相关单元共 32 项、隔离 Chromium 旅程及 TypeScript、Web ESLint、格式、Agent Note 和文档中心保护检查通过。旅程覆盖三类设定卡及深色窄屏的确认、取消和实际舍弃；截图位于 `.local/application-dialogs/`。ESLint 规则另以直接调用、window 调用及 globalThis 调用验证拒绝，并验证具名业务方法可通过。
