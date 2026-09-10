# 演示工坊头像

- 资产：`web/public/brand/presentation-workshop-mark.png`
- 生成时间：2026-09-10
- 生成方式：内置 ImageGen，以现有视觉创作工坊徽章为样式参考，生成琉华子头像。
- 角色参考：[STEINS;GATE 比翼恋理のだーりん官方角色页](https://steinsgate.jp/darling/character.html)，[琉华子立绘](https://steinsgate.jp/darling/common/img/cc6.png)。原作立绘仅用于生成参考，未复制为应用运行资产。
- 样式参考：`web/public/brand/visual-workshop-mark.png`。
- 图像未经额外绘制或合成，直接复制内置生成工具输出；应用卡片、侧栏和最近访问通过应用定义的 `brandImage` 使用同一资源。
- 权利范围：原作角色未提供独立再分发授权；仅限项目内部开发交接，不推定可公开发行或再许可。

## 最终提示词

```text
Use case: style-transfer. Create one sibling application avatar for Presentation Workshop / 演示工坊. Input image 1 is the established workshop badge style and composition reference (Kurisu badge); input image 2 is the official character reference for Ruka Urushibara / 漆原るか / 琉华子 from Steins;Gate. Replace the character with a clearly recognizable chibi Ruka using image 2: short dark black-green bob with side-swept bangs, small pale hair clips on the side, delicate face, softly shy warm smile, white shrine maiden top and deep red hakama accents, no cat ears. Match image 1's large antique brass gear circle, thick clean dark brown illustrated outlines, warm cream/apricot full-bleed background, subtle paper texture, polished hand-painted cel shading, warm orange accents, and compact app-icon composition. Ruka's large head centered inside the gear, chest-up view, eyes open and facing viewer. In the lower foreground place a small landscape cream presentation board showing only a simple terracotta bar chart and two simple layout shapes, no writing; Ruka holds a slender presentation pointer angled toward the board. Keep the board below the face and small enough for the character to dominate. Exactly one character, whole gear and props visible within a tight 3% safe margin, no large blank margin. No text, letters, watermark or UI screenshot. One high quality square 1024x1024 illustration matching the existing workshop icon family.
```

