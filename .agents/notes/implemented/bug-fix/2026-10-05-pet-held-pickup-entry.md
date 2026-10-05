# Agent Note: 完整帧拎起保留本次固定抓取锚点

Status: implemented

## Problem

拎起外层根节点将实际按下点在220毫秒内缓动到当前已绘腰点，完整帧内层又把当前缓动点作为每帧抓点目标。两层平移互相抵消，使同一张首帧在非腰部按住时立即跳到鼠标。独立真实public core→SequenceFigure调用复现：60源单位偏差在实际比例0.7933／1.2735下分别造成47.598／76.41 DIP首帧跳变。旧代数推断不作为这条复现的替代。

## Decision

Core在一次抓取开始时，通过figure公开pickupPoint取得并复制有限二元模型坐标P0；该点来自最后实际提交画面，包含其现有完整帧平移。原gripPoint继续沿用被按位置到P0的缓动，新增可选WhaleFrame.heldPickupPoint只传递本次固定P0。完整帧渲染器优先将P0交给已有播放器抓点求解，不新增播放器状态、隐式共享状态或源图缩放。

外层负责按下点到腰点的连续转移，内层只登记每张完整原图到P0；两层生命周期不再混淆。重抓从当时已绘画面重新取得P0，不强制回原始原点；等待或拒绝保持现有画面。旧figure继续消费原gripPoint并忽略可选字段。

松手保留内层平移，既有放置交接以实际绘制根与宿主屏幕原点维持相同离开帧；不能在松手时清零平移。不同源腰点的完整展开／落地素材仍需要独立的退出登记和视觉验证，本改动不替这些缺失原画提供生命周期。

## Alternatives considered

- 加长缓动或减小摆动：外层仍被抵消，不能修复首帧跳变。
- 修改播放器的模型／屏幕换算：现有锚点求解对稳定目标正确，应修正输入职责。
- 按住／松手时归零完整帧平移：会破坏重抓和实际放置连续性。
- 为每帧缩放或猜测腰坐标：隐藏源图登记问题，且不解决生命周期错误。

## Consequences

变更限制在core、私有WhaleFrame声明与完整帧适配器，不改变PetMotionFrame、IPC、公共API、数据库或资源描述。P0是已登记模型坐标，不是源像素、DIP或随每帧变化的鼠标点。实际抓取仍遵守150毫秒／4 DIP阈值；只修入口的坐标连续性，不声称新原画自然、人体腰点准确或完整松手姿势通过。

## Verification

14项测试经过实际createPet→SequenceFigure→SequencePlayer和真实生产drawImage／foreignObject调用，浏览器Canvas／Image边界受控。覆盖零偏差与x/y偏差、两个非单位显示比例、首个相同原帧、110／220毫秒、不同源抓点、延迟解码、已平移画面重抓、宿主原点变化与相同离开帧保留非零平移、旧figure输入、缺少held及读取失败明确恢复。容差0.11 DIP针对外层SVG实际0.1 DIP取整；不是人体支点或OS合成验收。

9文件203项相关回归、Web类型、范围内lint、四文件格式、vendor JS语法和diff检查通过。初次lint把项目明确忽略的vendor文件纳入max-warnings范围而失败，保留日志；最终TS lint与vendor语法／格式分别检查。冻结d6b83221974d9502f92525f28a4e5607b856bd05615393997c3e0e426b8b9260属于本版core/figure/types/tests，未继承旧159b的native或整体门禁结论。反向内存重建仅本次修改的旧字节与原只读SHA一致，未checkout或覆盖既有未提交改动。

原合成复现保留在held-grip-public-repro，修复报告保留在held-grip-contract-review/implementation；合成标记不冒充人物解剖点。整合9文件冻结32434a578fea2ca47a2b78f7e9b08afbd11f40d1f430b3486b61ed741ac50ad2，56文件952项桌宠测试、完整lint／Web类型与build通过；本轮native测试只核对加载反馈恢复，不能替代真实抓取或自然姿势验收。Mac锁屏，系统桌面物理拖拽和三服饰／鲸鱼／所有动作视觉验收未完成。正式资源未更新，正式App未重启。
