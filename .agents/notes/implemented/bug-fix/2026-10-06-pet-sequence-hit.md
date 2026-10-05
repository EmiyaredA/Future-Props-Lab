# Agent Note: 完整人物序列按实际可见原帧接受鼠标命中

Status: implemented

## Problem

完整人物序列仍沿用鲸鱼的固定圆形命中。新弯腰原帧的脸、靴子与发尾实际可见却在旧圆外，帧内透明空白反而落在圆内，独立桌宠因此漏掉可见部位的点击与按住。实际隔离 Canvas 像素与 SVG 投影证明此错位，不能靠扩大圆形修正不同姿势。

## Decision

可选 WhaleFigure.hitTest 接收模型坐标，明确 false 拒绝命中，null 或没有入口保留基础角色判定。core 按实际安装的 SVG 平移、旋转和等比／翻面缩放逆投影；采用同一舍入规则，仅影响命中，不改宿主确认、身体支撑或抓取的未舍入物理坐标。

完整帧适配器拥有当前成功绘制原图、图集 rect、modelBox 与完整帧平移。复用一个 1×1、willReadFrequently 的 CPU 画布，从已解码原图取样 alpha >24；不读取主 GPU 画布，不重解码、不重建渲染器、不改变源图透明度。新选择等待或加载失败仍以旧实际画面判定，首次基础站姿保留原判定。画布安装异常后不认证已清空的画面。

读回失败通过既有素材错误入口反馈并拒绝该图片命中，不把透明区退回旧圆。相同失败图片不在每次鼠标移动时重复读回；用户明确重试、换图后成功取样恢复。被淘汰失败图片及成功新图读回解除失败图强引用，最终 dispose 释放采样画布和缓存。只有内存状态，不增加包字段、公共 REST、持久配置或数据库 schema。

## Alternatives considered

- 扩大旧圆或包围盒：仍接受透明空白，无法随弯腰、悬挂与其他完整姿势准确变化。
- 每次鼠标移动从主画布读回或建立整图 mask：增加 GPU 同步和大图内存；复用已解码原图的单像素采样只处理当前必要点。
- 未舍入根矩阵直接逆算：独立回归复现 source x=880.1 误算为879.87475，落在透明像素。改用实际安装值，不修改运动坐标。

## Consequences

旧无自定义入口的鲸鱼／人物保留原判定，完整帧明确 false 不被 fallback 吞掉；Live2D 原接口不变。修复的是角色鼠标命中，现有头部热区分类、按钮通路与编辑器试玩按钮仍有各自职责。本改动不证明动作自然、进入放下连续、四边攀爬支撑或全部服饰已经视觉验收；候选不应用到正式资源。

## Verification

15 项专用生产接口回归覆盖真实审阅点对应的脸／靴子与透明空白、alpha 阈值、图集偏移、modelBox／完整帧平移、实际提交与等待、失败保留、重试／换图／dispose、失败图引用、旧圆 null／缺省以及明确 false、舍入、旋转、负缩放。jsdom CPU 后端验证调用与采样，不冒充浏览器实际像素。已有 group-facing 测试仅分离新1×1采样与主 drawImage spy，不删除 hover 行为断言。

冻结 core ca3de6394b7f22cb55ff9e5ae8dfad3e1d8b266e8499892a5f8393e982b365dd、figure fd3eff2a153fe64e3eb369f4128442af2beab0b142aff7f6869994da83f6f18a、figure.d.ts 31ab6e5191ff9ff1c77b1157ff36916ee2f54a4e575d824532abe755cf20dfad。64 文件1071项桌宠回归、Web／桌面类型、完整lint／format／build、48项架构检查通过；构建现有大chunk提示保留。第一次lint因默认uv cache不可写未运行，改用忽略目录缓存后同一命令通过，未改规则。契约／SDK、官方导入包与LFS检查通过。

独立只读审查首次12项中11通过、舍入边缘失败；修正后同一复现12项全通过。新冻结的实际隔离 Electron 点击与按住验收正在执行，尚不授予 OS 点击穿透通过；原生事件权限 preflight=false，不用 CDP 事件冒充 OS 合成。证据在仓库忽略的 whole-sequence-hit-audit、whole-sequence-hit-review-v1、whole-sequence-hit-native-v1 与 whole-sequence-hit-validation。

### 冻结 v2 实际鼠标检查完成

同一 v2 的隔离 native 12案例完成：脸、靴子、发尾各自短点接受、230ms按住进入held、8DIP再30DIP拖动进入held；alpha0三案例保持idle与宿主窗口位置。四主题1466编号、manual2881编号保留待独立编码核对。所有请求记录为同一隔离API origin，新项目经API创建／诊断配置，3源与2test冻结哈希未变；正常清理自有进程，不调用模型。

face短点实际native-hit:click而非pet，证明旧host高度0.48头区仍错误，该分类不在本轮命中通过范围。第一次preload桥探针未匹配，清理后补连502失败均保留，尚没有实际interactive布尔，不从alpha拒绝推导OS或桥点击穿透。正式WAL哈希改变再次记录formalFingerprintFreeze=false，写入者未知，不能以主文件未变声称正式数据冻结；独立启动test-data-dir、gateway与新项目API界限仍逐项记录。新头部分类需新冻结和独立实测，不改写本版失败。
