# 面试助手头像

- 资产：`web/public/brand/interview-assistant-mark.png`
- 生成日期：2026-10-23
- 生成方式：内置 ImageGen，按用户反馈重做；以官方原图约束发型、脸部与女仆服装，思绪工坊头像仅用于匹配画风。
- 角色参考：[游戏官方角色页](https://steinsgate.jp/darling/character.html)与[真由理立绘](https://steinsgate.jp/darling/common/img/cc2_1.png)。
- 女仆造型参考：[万代南梦宫 2018-09-19 官方宣传稿](https://am.bandainamco-am.co.jp/documents/news/2018/09/20180919_14-P-063.pdf)第一页主视觉最右侧的椎名真由理。采用短碎发、蓝绿色眼睛、白色女仆发饰、白色泡泡袖、黑色腰身及紫红色领结与腰带。
- 样式参考：`web/public/brand/thought-workshop-mark.png`。
- 原作参考仅保存在忽略的本地验收目录，不进入运行包；生成结果原样复制，未额外合成。
- 应用卡片、侧栏及最近访问通过应用定义 `brandImage` 共用该资源。
- SHA-256：`94a126bece0c8a7593905347156abc800fa25ee946f16a3a17bba5f7dfba6074`
- 权利范围：原作角色未提供独立再分发授权；沿用项目内部开发交接范围，不推定可公开发行或再许可。

## 最终提示词

```text
Use case: identity-preserve / stylized-concept. Create a replacement square app avatar for FPL Interview Assistant. Reference image 1 is OFFICIAL Bandai Namco STEINS;GATE 0 maid event key visual: Mayuri Shiina / 椎名まゆり is the RIGHTMOST girl with very short dark green-black hair, turquoise-green eyes, white ruffled maid headband, white/lavender puff-sleeved blouse, black fitted waist, magenta/mauve neck bow and magenta sash, white apron and black skirt. The middle redhead is NOT the target. Reference image 2 is an OFFICIAL original-game Mayuri character sprite: use her distinct short choppy pixie-bob silhouette, small uneven separated bangs, wispy pointed locks sticking out at ear level, open gentle eyes and innocent calm cheerful expression. Her hair must be SHORT, ending at ear/upper-jaw level, not a rounded shoulder-length bob; no thick side-swept long fringe or large generic doll curls. Retain a clearly recognizable Mayuri face from these official references while simplifying to chibi. Reference image 3 is STYLE ONLY: established FPL brass gear badge, warm cream/apricot full-bleed paper backdrop, bold brown outlines, subtly grainy cel-painted shading, generous head size. Do NOT copy its character. New subject is one chibi Mayuri, chest-up inside gear, wearing the official maid costume from RIGHTMOST girl of image 1, magenta bow (NOT blue ribbon), white ruffled headband without cat ears. Warm reassuring smile, teal-green irises. Interview props only: small cream checklist clipboard held low on the right and one small terracotta speech bubble low on left. NO film strip, no cinema objects, no fountain pen, no book. Large face, compact badge composition, entire gear visible with 3% safe margin. No text, lettering, logos or watermark. Exactly one character. The primary priority is recognizable official Mayuri hairstyle, facial features and maid costume, with the badge family's visual style.
```

