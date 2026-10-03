# 桌宠工坊头像

- 资产：`web/public/brand/desktop-pet-mark.png`
- 生成时间：2026-10-03。
- 生成方式：内置 ImageGen；先生成女仆装红莉栖头像，再按用户要求加入桌宠主题装饰。
- 样式与角色参考：`web/public/brand/visual-workshop-mark.png`。沿用暖杏色背景、黄铜齿轮、深棕描边与 Q 版比例；角色采用红棕长发、蓝紫眼、黑白女仆装与红色领结。
- 装饰：带爪印的迷你桌面屏幕、鼠标指针、爪印徽章与爱心，表达桌面互动和陪伴。保持脸部清晰与齿轮边框完整。
- 最终生成结果直接复制为 PNG，无额外绘制；应用卡片、最近访问与工坊侧栏通过应用定义的 `brandImage` 共用同一资源。
- 权利范围：原作角色无独立再分发授权，沿用项目内部开发交接范围。

## 初始提示词

```text
Use case: stylized-concept
Asset type: square application avatar badge for Future Props Lab Desktop Pet Workshop.
Input image: visual-workshop-mark.png is the exact sibling style and character reference.
Primary request: Create a matching new badge featuring chibi Makise Kurisu (红莉栖) wearing a classic black-and-white maid outfit. Keep her recognizable long reddish chestnut hair, side-swept bangs and blue-violet eyes. White frilled maid headband, modest black dress with white collar, puff sleeves and white apron, a small dark red ribbon at the collar. Face dominant, chest-up portrait, slight shy confident smile, hands gently held together at apron. Single character.
Style/medium: match reference warm hand-painted anime badge, bold dark-brown outlines, chibi proportions, clean cel shading and subtly textured brass gear.
Scene/backdrop: same full-bleed cream/apricot background with warm peach circle inside a complete brass gear ring. Entire gear visible with tight safe margin, balanced centered layout, clear face at 48px display size. The lower gear teeth remain visible.
Constraints: one square bitmap image, no text, no watermark, no additional characters, no filmstrip, no clapperboard, no picture frame, no lab coat, no UI mockup. This is the maid Kurisu avatar itself, not a screenshot. Follow reference style closely.
```

## 装饰调整提示词

```text
Use case: precise-object-edit
Asset type: Desktop Pet Workshop application avatar, square bitmap.
Input image 1: edit target, existing maid Makise Kurisu badge. Input image 2: Visual Workshop sibling badge, supporting style reference for the decorative foreground props only.
Primary request: Add a few clear decorative elements to express the Desktop Pet Workshop. Keep the current maid Kurisu character identity, facial expression, eyes, hairstyle, costume, painting style, warm cream/apricot backdrop and brass gear unchanged. Add a small tilted coral desktop monitor/window at the lower left, with a simple paw-print symbol in its screen and a tiny mouse pointer beside it. At the lower right, add a brass-edged coral paw-print charm with a small floating coral heart above it, expressing pet companionship and touch reactions. Use bold dark-brown outlines, cel shading and brass/coral colors just like the foreground props in the Visual Workshop reference. These props should be large enough to read at small application icon size, grouped beside the lower torso. Maintain a dominant unobstructed face and visible clasped hands; no props near the eyes or headband. Match the sibling icon's balanced foreground decoration. Keep bottom gear teeth visible. No text, letters, numbers, logos, extra characters, film props, or watermark. Output one square icon.
```

