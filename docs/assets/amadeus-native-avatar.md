# Amadeus 原生动态头像素材

本素材仅用于项目内部开发交接。角色形象沿用现有 Amadeus 头像的视觉设定，不推定其具有独立公开再分发授权。`amadeus.fpllive2d` 是 FPL 原生可编辑工程，不是 Cubism `.moc3`。

## 来源与生成

- 内置 ImageGen 于 2026-09-25 生成两张 1254 × 1254 透明 PNG，现存于 `web/src/features/amadeus/art/`；输入参考是此前的 `amadeus-state-atlas.png`，仅用于人物身份与配色。生成时不使用 API Key 或外部素材服务。
- 首张 `amadeus-neutral.png` 是正面半身原画，第二张 `amadeus-blank.png` 是保留发型、衣装、脸型和鼻影、去除眼眉嘴的同尺寸底画。
- `scripts/build_amadeus_model.py` 从这两张原画确定性拆出后发、脸、刘海、眼睛、眉毛、嘴与服装，绘制闭眼、表情口型与托腮手势，建立网格、变形器、参数、七种动作/表情及状态绑定。生成工程包、同源定帧和前后端姿态对照样本。运行：`uv run python scripts/build_amadeus_model.py`。
- `amadeus-poster.png` 由 FPL 后端角色渲染器对工程的待命首帧生成；它与动态头像使用相同的工程素材。

## ImageGen 提示词

第一张原画的核心提示词：

```text
Use the existing Amadeus state atlas as a style and identity reference only. Create one polished, perfectly front-facing, chest-up anime character portrait matching the reference: long straight reddish chestnut hair with center-parted pointed bangs, pale warm skin, violet-gray eyes, white lab coat over a white shirt and narrow red tie. Calm neutral expression, symmetrical body and face. Clean precise dark-brown line art, warm restrained shading, simple flat color regions. Transparent background; no peach frame, no symbols, no text, no effects, no extra character. Square composition, face readable at 48 pixels.
```

第二张编辑图的核心提示词：

```text
Edit the supplied transparent portrait. Change only the face interior: remove both eyes, all eyebrows, and the tiny mouth line, replacing them with seamless continuous pale skin and the same subtle nose shading. Keep the exact same head and jaw silhouette, hair shape and highlights, white coat, red tie, canvas proportions, placement, colors, line weight and transparent background. No face features except the faint nose. No extra objects or text.
```
