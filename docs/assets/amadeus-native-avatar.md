# Amadeus 原生动态头像素材

本素材仅用于项目内部开发交接。角色形象以用户最后指定的透明半身图为准；不推定原作角色具有独立公开再分发授权。`amadeus.fpllive2d` 是 FPL 原生可编辑工程，不是 Cubism `.moc3`。

## 来源与生成

- `web/src/features/amadeus/art/kurisu-neutral.png` 是用户在本轮明确选定的图 3：红棕长发、灰蓝眼、白大褂与红领带，1087 × 1446 透明 PNG。它替换了此前眼距过宽的草稿；不能从旧草稿重新生成正式模型。
- `kurisu-blank.png` 是经该原画编辑得到的 1087 × 1447 去表情底画。编辑提示词：保留发型、脸部轮廓、鼻影、衣装与透明背景，只去除眼睛、眉毛和嘴部，以便独立分层。打包时给选定原画底部补一行透明像素以对齐画布。
- `scripts/build_amadeus_model.py` 从两图确定性拆出 18 个透明 PNG 部件，建立 12 根半身骨骼、每顶点归一化蒙皮权重、参数、七种动作与表情、头像及舞台相机位，输出 v3 工程包和姿态样本。运行：`uv run python scripts/build_amadeus_model.py`。
- `amadeus-poster.png` 与 `amadeus-stage-poster.png` 由同一工程的两个相机位定帧渲染，用于加载、减少动态效果和图形渲染失败时的回退。

## 原画生成与修订提示词

最初的半身原画以用户提供的参考截图为形象依据，经内置 ImageGen 生成；用户随后指出眼距与面容差异，并在多次修订后指定最终图 3。最初提示词的核心约束为：

```text
Front-facing waist-up anime portrait matching the supplied reference: long straight reddish chestnut hair with pointed bangs and a curled lock over the right shoulder, pale skin, cool gray-blue eyes, white lab coat over a white shirt and narrow red tie. Calm face, clean dark-brown line art, restrained shading, transparent background, no frame or text.
```

最终像素以用户选定图片为准，不以该文字提示词重建。
