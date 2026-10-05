# Agent Note: 完整序列帧中央预览使用共用画布取景

Status: implemented

## Problem

中央桌宠预览按旧角色260×320模型范围和128/256参考点取景。合法完整序列帧的共用modelBox可能更大或带非零原点，中央舞台因此裁掉头或脚；只移动资源登记原点会裁掉另一端。固定first startX也不能在窗口宽度变化后重新居中。

## Decision

只有合法完整序列资源且center视图使用统一modelBox等比取景，按舞台宽高与最多8DIP留白计算一个相机scale。全序列共用画布中心对应舞台中心；资源modelBox、原始PNG、源到模型比例与foot/grip登记保持原样。WhaleRenderer通过私有bounds.centerX传递相机参考pivot；core在walkInPlace且值为有限数时resize更新pivot，并以此作为in-place水平参考范围，避免旧104*S边界再次裁切负原点/大画布。heldAnchor不被resize覆写。floor/实际独立桌宠、旧无序列角色与无效资源仍沿原路径。

## Alternatives considered

只修foot或平移modelBox登记已真实证明会裁头；overflow可见会侵入操作区；逐帧alpha包络拟合会造成比例跳变；读写core私有pet.x使渲染器耦合控制器内部。统一modelBox取景与明确camera pivot避免这些问题。

## Consequences

透明留白参与共用画布取景，因此某些原画在中央舞台看起来更小，但不同帧比例保持一致。相机参考点可落在视口外，这不是角色物理越界；该行为仅中央in-place预览启用。修复不证明素材动作自然、支撑稳定、四边活动完成或tile警告因果，不更新正式资源。

## Verification

新7项真实core/SequenceFigure测试覆盖正负原点、四组响应尺寸、resize重居中、实际换cel比例一致、floor/旧路径、held resize和非法pivot。13文件228项相关测试通过；新测试补齐必填motionFacing后nativeTS通过，scope eslint/Prettier与vendor语法检查通过。真实完整隔离Electron六张明暗主题对照中，原B和足底登记B全画布及alpha包络均未裁切，旧正常Kurisu仍显示完整；项目config/revision不变，模型请求0，源文件before/after一致，进程已清理。静态截图/矩阵不是完整动作或原生OS合成录像验收。
