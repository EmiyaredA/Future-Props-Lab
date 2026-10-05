# Agent Note: 完整序列复用相同位图，继续提交播放状态

Status: implemented

## Problem

完整序列在原画未变化时仍每次清空并绘制整个Canvas。公开生产core→SequenceFigure受控600次静态推进加首绘制共601次drawImage；固定显示方向修复不消除这部分工作。相同像素可能对应不同抓点、位置、支撑与计时，直接缓存整个样本会冻结交互或错误恢复。既有tile警告尚无根因归因。

## Decision

SequenceFigure实例保存最近成功安装的位图键：实际Image对象、复制的裁切数组、原生canvas尺寸和当前配色。键相同只跳过clearRect/drawImage，仍执行播放器选择、确认位移校验、DOM/样本/几何/抓点安装、计时、进度、错误恢复与隐藏基础表面退休。新键在清空前失效，Canvas或DOM异常原样抛出并使键失效；成功安装后才记录新键。等待和失败沿用原画保留规则，不把解码结束或键相同当作恢复成功。

图集淘汰时若键引用该Image则解除引用，最终dispose同时解除键和缓存；load入口拒绝已dispose实例的新请求。保留既有16M请求、32M图片缓存与当前几何采样预算，不新增全局缓存、API、资源字段或持久化。原窗口位置与运动控制器职责不变。

## Alternatives considered

- 按样本或片段ID复用：样本每次变化会妨碍复用，同名片段又不能保证像素相同。
- 按URL复用：同URL重新解码为新Image，不应沿用旧内容认证。
- 相同位图时返回整个draw：会跳过新抓点、几何、计时及有效重试后的恢复。
- 增加共享缓存或降低统一画布分辨率：扩大生命周期或改变画面质量，不是此处必要修复。

## Consequences

此优化仅减少重复位图绘制，不能证明实际GPU带宽、VRAM释放或tile警告原因，更不表示行走/拎起/四边原画通过视觉验收。换图、裁切、配色或原生尺寸变化仍重新绘制；菜单、取消、重播不因名称变化强制重绘。旧测试中三处“有效同像素提交必须多一次draw”改为精确不增加次数，并保留/补充实际进度、错误清除、时钟及根位置验证，不放宽到大于等于。

既有Canvas异常后Player已采样而Figure时钟尚未提交的时间交接局限另行保留；本补丁不修改Player。异常测试使用下一合法时间验证真实重绘，不声称异常前像素能在clear后回滚。正式资源和App未更新，新动作验收仍独立。

## Verification

14项新测试使用真实SequenceFigure/Player、受控浏览器Image/Canvas边界，验证600次静态推进只各一次clear/draw而600次后续DOM提交仍执行；同像素不同抓点/接触/过渡时间、固定P0、确认位移支撑、pending/失败保留与有效重试清除、配色Image和裁切/原生尺寸变化、Canvas/DOM异常、32M淘汰重解码、迟到回调与dispose。原18文件401项相关测试、Web类型、局部lint/格式通过，首次3项新fixture失败及4项旧次数冲突记录保留。受控数值支点不当作人体自然或真实桌面验收。

主Agent整合13文件c8631005504ee19d52e16a12261d7a6ba011ca81db467241a4b6ab44f5d7496f使用sorted compact JSON算法；独立四文件实现ffc6c6a9d116067d84758b2299b50298279faddfeea343ac1e3d3faddc65f53a使用sorted path NUL sha LF算法，两者范围分开。figure SHA f2b04a973a8bb386f6c4cbaaab5850945395efc14ade258c064079dc9437ce61。整合58文件990项桌宠测试、完整lint/Web与桌面类型、build通过，既有chunk/dynamicURL构建警告保留。当前新native计数正在独立验证，此前61d30b方向与32434a恢复证据不冒充本次执行。报告与冻结保存在忽略目录sequence-paint-cache/；来源与正式应用验收完成后另记结果。

### c863 独立原生计数与恢复结果

c863冻结的隔离Electron原Canvas在3.2秒205个真实rAF观察与820次FO属性写入中clear/draw始终各1次；同图重播、明暗、按住与松手不增加绘制。实际配色命名空间生成新的Image（ID7→9），同Canvas只新增各1次。两个命名空间都是原经典站姿的同字节副本，不是新服饰或自然动作。

首run错误要求FO坐标必须变化，实际外层CTM才承担本例位移；第二run把素材ID当URL导致abort为零，等待超时。两份complete:false、原脚本和原录像保留，有限计数观察不升级为整体通过。最终仅补恢复范围：授权实际请求abort1次，错误及原画在1900ms待机、2100ms真实decode回执等待中保留，目标总请求2次；明确短点重试后实际新Image提交clear/draw1→2，原错误和顶部异常清除，余下缺动作原因保留。主Agent实际查看失败、pending和恢复窗口截图。

原Canvas1145×1374、统一modelBox不变，原图alpha最大差0，PMA最大舍入差小于1/255。94文件规范集合及13文件freeze在三run前后匹配，CAS诊断基线rev0→1后保持不变，lease=null、桌宠关闭、自有进程0、模型请求0。原生报告位于忽略目录sequence-paint-cache-native-plan/native/report.md。

第二run1594真实原帧、最大gap133.869ms，预览编码漏1帧如实保留；最终恢复374真实原帧、最大gap121.960ms、预览374帧。没有补帧，不宣称逐段30fps。此轮未重新观测GL trusted loss，不借旧退休证据冒充本轮；没有测GPU内存或归因tile警告。自然运动与OS手拖仍未验收，Mac仍锁屏，正式资源/App保持原状。后续Player/Figure异常采样事务修复拥有新源码和独立验证，不能继承c863原生证据。

### 异常时钟交接的后续修复

采样与可见安装由新的同步边界一起提交，原异常后短帧失效的问题见[后续提交 Note](2026-10-05-pet-sequence-presentation-commit.md)。本 Note 的 c863 源码、失败与原生证据保持原范围；新源码验证不继承旧原生通过。
