# Agent Note: 桌宠确认放弃后的单次导航

Status: implemented

## Problem

实际隔离 App 在未保存桌宠工程选择“放弃修改”后，标题变为已保存，却仍留在编辑器并再次弹出确认。返回按钮将 onBack 交给父导航；在 React 提交 dirty=false 之前，父导航仍消费上一轮 dirty=true 的拦截闭包，重复阻止同一次已确认离开。

## Decision

确认放弃时，EditorPage 先同步解除自身已注册的导航拦截，再更新本地 dirty／弹窗状态并执行已接受的 continuation。只在显式确认处理中解除，不在返回请求或取消处理中提前放行。父导航、Workspace 与未保存保护协议不变，不新增全局绕过标记。

确认不调用保存、不修改 revision，实际卸载继续释放编辑器临时联动。重新进入读取原保存基线。“继续编辑”仍保留草稿与拦截。

## Alternatives considered

- 多次确认或定时重试 onBack：仍重复执行已接受的导航，未采用。
- 关闭全局未保存保护：破坏其他编辑器及受控更新，未采用。
- 等待任意 timeout／强制页面刷新：不表达确认语义并中断联动清理，未采用。

## Consequences

只有用户已接受的离开能同步放行，草稿不自动持久化。编辑器保持原配置与保存生命周期，无公共契约或数据库变化。

## Verification

- 组件测试先在原源码复现：header 返回确认后 commit=0，父级直接 continuation 场景通过；原失败日志 retained。新两入口测试确认继续编辑保留 dirty、最终各一次 commit、无残留弹窗、0 保存调用及原配置／revision 不变，editor 全 10 项通过。
- EditorPage SHA 为 9d2ad0ba40ff23f2fefc5b9083f22bb6bbc586aca6ff02844549448ebfb55437。真实完整隔离 App 87 文件前后 SHA 7c642099414f381558ed25db9c40b491f3d5df152d4a55e2505c9966491913b2 一致，实际继续编辑、单次放弃回列表、授权 API 配置／revision 不变、重开保存基线、干净离开与联动释放通过；唯一桌宠写请求为隔离导入，无配置保存或模型调用。
- 原三次退出失败与新报告／UI截图保存在 .local/desktop-pet/full-app-sequence-check/rejected-reaction-after/；root 查看修复后列表和重开截图，不改写旧记录。全部独立进程已结束，未重启正式 App。
- 当前私有反应、资源清理及导航版本的完整桌宠 Web 52 文件／891 项、完整 lint／format／build 与类型通过。此导航回归不代替新动作、物理支持或系统桌面录像验收。
