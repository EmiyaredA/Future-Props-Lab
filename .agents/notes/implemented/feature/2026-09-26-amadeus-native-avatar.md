# Agent Note: Amadeus 原生动态头像

Status: implemented

## Problem

Amadeus 的七种执行状态原本只切换四帧雪碧图；工坊虽能保存状态绑定，却没有可编辑的 Amadeus 工程，也没有让助手窗口播放原生网格模型的入口。控件选取取消后，头像还可能一直停留在聆听状态。

## Decision

随 Web 包提供一份完整的 Amadeus `.fpllive2d` v2 工程。由两张透明原画确定性构建 15 个分层 PNG、变形器、参数、七组表情和动作，再以现有角色渲染器生成静态回退图。工坊与助手窗口共用 `shared/live2d/` 的姿态和 PixiJS 网格装配。助手窗口只读加载内置工程；用户明确点击“导入 Amadeus 模型”时，才经已有项目导入 API 在当前 Workspace 建立可编辑副本。控件选取结束由受限桌面 IPC 回告助手窗口。

## Alternatives considered

继续扩展雪碧图不能提供可编辑网格与参数。把模型预先写入用户运行数据库会绕开正式 API，也会干扰已有 Workspace。引入 Cubism Core 与 `.moc3` 则偏离当前确认的 FPL 原生工坊路线。

## Consequences

应用仍保留独立的 Live2D 工坊齿轮徽章。头像运行依赖随包提供的工程和 WebGL；加载中、图形加速失败或减少动态效果时可使用同源定帧。无需新数据库表和公共 API。七组表情参数与动作轨道互不重叠，遵循现有“动作覆盖同名表情参数”求值规则。

## Verification

工程包通过正式解析器和隔离 API 的导入、导出往返验证。七种状态在 76 像素输出中形成不同画面，Web 姿态与 Python 渲染器生成的对照样本逐项比较；桌面隔离烟测检查动态渲染和聆听状态退出。
