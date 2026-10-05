# Agent Note: 完整帧包装失败时释放基础渲染器

Status: implemented

## Problem

WhaleRenderer 先加载基础人物或鲸鱼，再构造完整帧包装；包装请求 2D context 失败时，基础 WebGL 已建立但尚未赋到当前 figure，旧 catch 和卸载清理都无法显式释放它。错误提示正常显示不能证明资源所有权已结束。

## Decision

只在完整帧包装构造边界捕获失败，由仍持有基础资源的初始化器调用 original.dispose，再原样抛出异常。成功包装后所有权移交，原 stopped 与正常卸载清理继续通过包装实例执行，不重复释放。无全局 context 重置、缓存清空、预算放宽或渲染器重建策略。

## Alternatives considered

- 只在卸载时释放 figure.current：基础资源此刻未挂到该引用，实际失败注入否定。
- 依赖浏览器 GC：不能证明确定性的显式生命周期，未采用。
- 提高 GPU 内存参数或禁用 GPU：没有匹配的根因证据，未采用。

## Consequences

失败时保留原错误并结束已创建资源的所有权。图像加载取消及浏览器解码／合成缓存没有改动：卸载前未完成的初始化仍等自身 settle，再按原 stopped 清理。此窄修复不证明真实显存增长或用户 tile memory 警告的根因。

## Verification

- 只读基线执行生产 WhaleRenderer→createHumanFigure→createRig→createSequenceFigure，故障注入只使包装的 2D context 返回 null；三轮 created=3、显式 loseContext=0，保留于 .local/desktop-pet/rejected-reaction/root-review/memory-lifetime-results.json。
- 新七项测试执行相同生产构造链，无 figure 工厂或 dispose mock，控制浏览器 Image／Canvas／GL 边界。多次失败、成功移交、成功／失败卸载后迟到初始化、旧 revision 迟到失败和 StrictMode 均恰好释放自身已创建 context；真实 GL API 的可控计数不是驻留显存测量。
- WhaleRenderer 最终 SHA 3a16ba9213c1330ddd6d740101966b3af1f7ee81e2f0d9f073dc66669c019cda，与测试的 scope combined 为 787f20a4233fc8c9b4205003fb096567ec0a2b875af3602d1d8bc02f9faa917a。精确相对前冻结源码的补丁和七项结果在 wrapper-fix/，其他生产文件未由该修改者改动。
- 90 项相关回归通过；root 最终完整桌宠 Web 52 文件／891 项、完整 lint／format／build 与类型通过。最新合法资源的真实隔离 App 换装／站坐／表情与导航正常，未故障注入原生 GPU、不把正常旅程无警告当 tile 根因已解决。
- 官方技术正文与职责索引更新。此前 v1 独占纹理过滤见[纹理引用闭包 Note](2026-10-05-pet-v1-texture-reachability.md)；正常资源开销与初始化取消的未证实风险保留只读 residual-memory-audit.md。无数据库、公共 API、正式资源或 App 更新。


### 后续真实 Electron 故障与恢复验证（2026-10-05）

在完整隔离App的人物加载链中，仅一个明确createSequenceFigure调用的detached1145×1374画布getContext(2d)返回null，其余Canvas／GL原生委托。原baseGL6在故障前完成14次真实texImage2D；生产humanFigure.dispose→WhaleRenderer catch查询原生扩展，约27.6ms后收到isTrusted=true的webglcontextlost，真实isContextLost=true。诊断没有调用或替换loseContext、伪造事件或用DOM卸载冒充未挂载original的释放。原错误“完整序列帧画布不可用”实际显示。

通过真正返回项目列表／重新打开，在明暗主题恢复真实绘制；当前活跃GL14／20与各自StrictMode迟到清理实例12／18分别记录。正常退出后全部6个实际上下文均原生lost。主Agent实读脚本／fault与recovery数据并查看原错误及明暗恢复图。config和revision0严格未变，除隔离导入外无写入；无模型请求，87生产文件前后规范SHA一致，自有进程清理为0。

证据在 `.local/desktop-pet/native-wrapper-failure-plan/version-run-2026-10-04T21-38-52-934Z/`。前三轮上传控件等待或StrictMode聚合断言的诊断失败保留，不改成生产失败或PASS；最终仅修诊断断言，不改源码／扩大故障seam。控制浏览器API单元证据和后续原生证据分别保留。该原生构造测试只覆盖human-chibi：鲸鱼base在mount才建立GL，包装前失败可能尚无上下文，不能混称已建GL释放。

本结果证明显式原生上下文生命周期，不量测显存回收、浏览器tile或OS合成。tile日志未出现不是此前正式编辑器警告根因修复证明；并行迟到初始化／decode峰值仍需独立诊断。console中的开发CSP及账号pattern错误分别记录，不称日志全空。Mac锁屏限制、新动作素材／正式资源验收边界未改变，没有正式CAS或App重启。
