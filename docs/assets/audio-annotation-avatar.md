# 录音标注工坊头像

- 资产：`web/public/brand/audio-annotation-mark.png`
- 生成时间：2026-09-18
- 生成方式：内置 ImageGen，以现有视觉创作工坊徽章为样式参考，并以原作立绘为角色参考，生成桐生萌郁头像。
- 角色参考：项目内提供的《命运石之门》桐生萌郁原作立绘（浅褐卷发、方框眼镜、棋盘格腰带扣、翻盖紫手机）。原作立绘仅用于生成参考，未复制为应用运行资产。
- 样式参考：`web/public/brand/visual-workshop-mark.png`。
- 图像经 ImageGen 输出后转为 PNG；应用卡片、侧栏和最近访问通过应用定义的 `brandImage` 使用同一资源。
- 权利范围：原作角色未提供独立再分发授权；仅限项目内部开发交接，不推定可公开发行或再许可。

## 最终提示词

```text
Use case: style-transfer. Edit image 1 into a new sibling application avatar for Audio Annotation Workshop / 录音标注工坊. Image 1 is the exact established workshop icon style reference and composition template; Image 2 is the official character standing portrait of Moeka Kiryu / 桐生萌郁 from Steins;Gate — match her appearance from image 2 as closely as possible in chibi form.

Replace Kurisu in image 1 with a clearly recognizable chibi Moeka based on image 2:
- long wavy honey-brown / strawberry-blonde hair flowing over shoulders
- black rectangular glasses
- reddish-pink eyes
- stoic blank detached expression (not smiling brightly)
- white short-sleeved button-up with black collar, thin black center stripe like a skinny tie, black sleeve trim with small ribbon ties
- wide black belt with a prominent black-and-white CHECKERED buckle (critical identifier)
- dark grey pinstriped mini-skirt accents
- holding her signature small purple/pink FLIP phone (not a modern smartphone) near her chest

Keep image 1's square full-bleed warm cream and apricot background, large antique brass gear circle, thick clean brown illustrated outlines, warm subtle paper texture, polished hand-painted cel shading, and balanced highly legible app icon composition. Moeka's large head centered within the gear, chest-up pose.

Replace the video clapperboard/film/photo foreground props with small audio props: over-ear headphones, a gentle waveform badge, and a small desk microphone — keep props below the face so character dominates.

Exactly one character. Whole gear and props inside the square, tight 3% safe margin. No text, letters, labels, logos, watermark, or interface screenshot. Produce one high quality square 1024x1024 icon, visually matching image 1 as part of the same existing workshop family, while Moeka must be unmistakably the character from image 2.
```
