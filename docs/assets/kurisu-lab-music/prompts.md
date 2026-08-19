# 生成提示词

## 1. 竖屏成图提示词（v3：视频帧画风 + 红莉栖身份）

```text
Use case: identity-preserve
Asset type: vertical anime music-video key visual
Input images: project Kurisu identity reference; three video action frames as the primary style, pose, gesture, headphone-listening and camera-energy references; a real DJ mixing-console photograph as the environment reference
Primary request: Generate Makise Kurisu listening to music in the soft semi-realistic anime music-video style of the supplied video frames. Preserve the video's gentle rendering, glossy hair, natural adult proportions, realistic lighting and lively close-camera gesture, while replacing the original character completely with Kurisu.
Scene/backdrop: A believable real-world DJ listening and mixing station with professional DJ controller, turntable jog wheel, mixer faders, studio monitors, cables, headphone gear, dim warm amber practical lights and subtle green/blue indicator lights, shallow depth of field, tactile metal and plastic surfaces. Use the real DJ photograph as the structural and lighting reference, but remove brands, logos and readable labels.
Subject: Makise Kurisu, young adult woman with long auburn hair, straight bangs, violet eyes, slim build, recognizable white lab coat over a dark top with a red tie, large over-ear headphones. One hand touches the earcup, the other arm reaches slightly toward the camera based on the video frames; relaxed shoulders, absorbed smile, subtle hair and coat movement. One character only.
Style/medium: soft semi-realistic anime illustration, high-quality AI music-video frame aesthetic, delicate facial features, slightly oversized expressive eyes but natural adult proportions, realistic warm lighting, glossy detailed hair, soft atmospheric bloom, photographic depth of field, clean anatomy, no hard cel-shading; anime character naturally integrated into a realistic DJ booth.
Composition/framing: vertical 9:16, medium-full to three-quarter full-body crop, camera close to the DJ console with the mixing deck large in the foreground and Kurisu behind it, dynamic low-angle perspective matching the action frames; keep face, headphones, hands and upper torso clearly visible; no player UI.
Lighting/mood: real warm amber/orange studio lighting from equipment and practical lamps, cooler rim light from monitors, intimate focused listening atmosphere, energetic but not a concert stage.
Constraints: video action frames are the primary style and pose reference; preserve Kurisu's identity, auburn hair, violet eyes, white coat and red tie; realistic DJ booth background; one character only; no text.
Avoid: original video character, chibi style, cat ears, fantasy costume, extra characters, extra limbs, extra fingers, malformed hands, detached headphones, duplicate headphones, warped equipment, modern clean office, generic empty room, watermark, Bilibili logo, subtitles, captions, player controls, readable brand names, excessive blur, oversexualized pose.
```

## 2. 跳舞视频生成提示词（推荐 8–10 秒，竖屏 9:16）

### 主提示词

```text
Vertical 9:16 anime character composited into a realistic DJ music-production booth, one consistent character only: Makise Kurisu, long auburn hair, violet eyes, white lab coat, dark top, red tie, large over-ear headphones. She is listening to music and doing a small, natural in-place dance behind a professional DJ controller. Use the real DJ reference for mixer, turntable, monitor speakers, cables, warm amber practical lighting, shallow depth of field and believable photographic texture. Preserve her face, hair, outfit, headphones, body proportions and the booth layout across the whole clip.

Choreography: start with a relaxed side profile while she presses one earcup, then gently nod to the beat; shift her weight from one foot to the other; make two restrained shoulder pulses; extend the free hand toward the camera for one beat and draw it back; finish with a small turn toward the window and a soft, satisfied smile. The motion should feel like a scientifically minded person privately enjoying a song, not a stage idol performance. Keep both hands anatomically correct and keep the headphones attached to her head.

Camera: stable vertical medium-full shot with a very subtle handheld music-video sway; begin slightly low and close with the DJ console large in the foreground, ease back just enough to show turntables, faders, monitor speakers, cables and warm room lights; no hard cuts, no zoom jumps, no camera rotation. Hair and lab-coat hem move slightly with the body motion. Realistic photographic background, anime character integration, coherent contact shadows and reflections, smooth 24 fps motion.

Use the supplied action frames as the primary motion and gesture references. Replace the original video character completely with Kurisu. Do not reproduce the original face, costume, watermark, logo, subtitles, player controls, or exact video frame. Do not preserve brands or readable text from the real DJ photo.
```

### 时间节奏

```text
0.0–1.5s  一手扶耳机，闭眼或半闭眼，轻轻点头，建立“正在听歌”的状态。
1.5–3.5s  肩膀与身体重心左右交替，另一只手做小幅度节拍动作。
3.5–5.5s  手掌向镜头伸出一个节拍，再自然收回；镜头只做轻微跟随。
5.5–7.5s  红莉栖向窗边小幅转身，长发和白大褂下摆产生滞后摆动。
7.5–9.0s  回到三分之四正面，露出克制的开心表情，以轻微点头收尾，方便循环。
```

### 负面提示词

```text
extra characters, character replacement drift, face change, hair color change, different outfit, missing red tie, missing headphones, detached headphones, duplicate headphones, extra arms, extra fingers, broken hands, warped legs, rubber limbs, exaggerated idol choreography, large jumps, spinning camera, hard cuts, rapid zoom, shaky camera, changing Lab layout, modern studio, outdoor background, watermark, logo, Bilibili UI, subtitles, captions, readable text, low resolution, flicker, frame interpolation artifacts, sexualized pose
```

### 建议参数

- 画幅：`9:16`
- 时长：`8–10 秒`
- 帧率：`24 fps`
- 镜头：单镜头、轻微手持感、无硬切
- 角色一致性：使用 `kurisu-character-reference.png` 与 `kurisu-lab-music-key-visual-v1.png` 作为身份/服装参考
- 动作参考：使用 `video-frames/frame-04s-clean.png`、`frame-11s-clean.png`、`frame-18s-clean.png`、`frame-26s-clean.png`、`frame-34s-clean.png`
