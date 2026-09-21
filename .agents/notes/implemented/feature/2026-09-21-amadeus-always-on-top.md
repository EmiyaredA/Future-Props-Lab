# Agent Note: Amadeus 默认悬浮置顶

Status: implemented

## Problem

Amadeus 是独立 Electron 单例窗口，与 Studio 无 parent 关系。用户在助手与主窗口之间来回点击时，系统 z-order 会把 Amadeus 压到主窗口后面，打断持续对话。

## Decision

Amadeus 默认开启 `setAlwaysOnTop(..., "floating")`，头栏提供 Pin 开关；偏好写入既有 `amadeus-window.json` 的 `alwaysOnTop` 字段（缺省为 true）。置顶仅在 Future Props Lab 任一窗口持有焦点时生效：应用失焦时临时取消置顶，不改写偏好，避免盖住其他系统应用。相关 IPC 仅接受可信 Amadeus 发送方。

## Alternatives considered

- **把 Amadeus 设为某个 Studio 的 `parent` 子窗口** — 子窗口天然跟在父窗口之上，但 Amadeus 是跨多个 Studio 窗口的单例，不能绑死某一个 parent。
- **无焦点感知的系统级 always-on-top** — 能解决层叠问题，但切到 Finder/浏览器时仍会挡桌面，不符合「相对本应用悬浮」的语义。
- **仅在 Studio focus 时 `moveTop()`，不用 alwaysOnTop** — 点击主窗口内容区时仍会把助手压下去，无法稳定保持可见。

## Consequences

- **收益**：默认保持助手可见；用户可一键关闭置顶；切走应用不挡其他窗口。
- **代价与已知上限**：置顶开启时点击 Studio 无法把助手压到后面（需先关 Pin）；焦点切换依赖 `setImmediate` 推迟 blur 同步，极端快速切窗时可能有一帧闪烁。
- **相关**：单例窗口与可信边界见 [`2026-09-20-amadeus-desktop-assistant.md`](./2026-09-20-amadeus-desktop-assistant.md)。

## Verification

`desktop/scripts/smoke-amadeus.cjs` 断言默认 `amadeusAlwaysOnTop() === true`、Pin 切换后偏好与 `aria-pressed` 同步。手动确认：Pin 开启时点击 Studio 助手仍在上；Cmd+Tab 到其他应用后助手不再盖住桌面。
