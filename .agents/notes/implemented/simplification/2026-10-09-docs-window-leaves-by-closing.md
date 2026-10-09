# Agent Note: 文档窗口离开时关闭，不再返回 Studio

Status: implemented

## Problem

桌面版把文档中心开在独立窗口里，这个窗口没有登记为 Studio 窗口。文档页「返回 Studio」会在同一窗口载入主应用。主应用随后轮询 `desktop:agent-status`，主进程因发送方不是 Studio 窗口而拒绝，终端持续打印「拒绝非应用页面请求」。原先的 Studio 窗口仍在，文档窗口不需要变成第二个主界面。

## Decision

文档中心不再提供「返回 Studio」。看完文档就关闭该窗口；Studio 窗口保持不动。桌面文档窗口的系统关闭按钮会销毁窗口，不会把它藏成主窗口。

## Alternatives considered

- **把「返回 Studio」改成调用 `window.close()`** — 仍留一个页内出口，而文档窗口已有系统关闭按钮；浏览器里由 `rel="noreferrer"` 打开的标签页也不能被脚本关闭。否掉。
- **导航回主应用后把该窗口登记为 Studio 窗口** — 能通过 IPC 校验，但文档窗口会变成第二个主界面，和「文档看完即关」不一致。否掉。

## Consequences

- **收益**：文档窗口不再载入主应用，也不会再以非 Studio 身份轮询 Agent 状态。
- **代价与已知上限**：文档页没有回到主界面的链接。浏览器里文档在新标签打开时，回到 Studio 需要使用原来的标签，或关掉文档标签。

## Verification

- `web/tests/navigation.test.tsx` 确认文档页没有「返回 Studio」。
- 桌面文档窗口用系统关闭按钮结束；主窗口继续可用。
