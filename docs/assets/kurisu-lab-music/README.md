# 红莉栖 · Lab 听音乐竖屏视觉

本目录保存一次“牧濑红莉栖在未来道具研究所戴耳机听音乐”的竖屏视觉探索，以及后续生成舞蹈视频所需的参考帧与提示词。

## 交付物

- `kurisu-lab-music-key-visual-v1.png`：第一版，项目内 Lab 背景的竖屏成图。
- `kurisu-dj-listening-key-visual-v2.png`：第二版，按视频动作帧 + 真实 DJ 工作室背景方向生成的竖屏成图，当前推荐使用。
- `kurisu-video-style-listening-key-visual-v3.png`：第三版，重点参考视频帧人物画风、柔和半写实质感和动作构图，当前最新版本。
- `video-frames/frame-*-clean.png`：从参考视频中截取并裁掉播放器控件后的 5 张动作参考帧。
- `references/kurisu-character-reference.png`：项目内红莉栖角色立绘参考。
- `references/kurisu-project-frame-reference.png`：项目内红莉栖场景/编辑器参考帧。
- `references/lab-background-reference.png`：项目内未来道具研究所背景参考。
- `references/kurisu-style-sheet-reference.png`：项目内角色设定参考图（用于颜色、发型和服装细节校对）。
- `references/real-dj-studio-reference.jpg`：网络检索到的真实 DJ 混音台照片参考，用于设备布局、真实材质、暖色灯光和浅景深。
- `prompts.md`：成图说明、视频生成提示词、负面提示词与分镜节奏。

## 视频参考来源

- B 站页面：[【Minimax H3】在播音室快乐跳舞的小睦~](https://www.bilibili.com/video/BV1dJu26EEtP/)
- 页面读取到的视频为竖屏约 40.5 秒、832×1120；本目录保存的是从播放器画面提取的关键帧，不保存原视频文件。
- 关键帧用途是参考动作节奏、手臂延展、镜头距离与“戴耳机听歌”的情绪；最终图和视频提示词不保留原角色、水印、播放器 UI 或站点标识。

## 真实背景参考来源

- [Unsplash：A pair of headphones sitting on top of a DJ's decks](https://unsplash.com/photos/a-pair-of-headphones-sitting-on-top-of-a-djs-decks-rQ4_6TSliRg)
- 直接图片地址：[images.unsplash.com/photo-1547210841-8d6bc04698f7](https://images.unsplash.com/photo-1547210841-8d6bc04698f7?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85)
- 这张照片只作为生成参考，重点借鉴真实混音台的结构、设备质感、暖色光线和景深；生成图不保留原照片中的品牌标识或可读文字。

## 版权与使用备注

参考视频来自第三方页面，仅作为本地创作中的动作与镜头参考。v1 使用项目已有的红莉栖与 Lab 素材；v2 使用项目内红莉栖素材、视频动作帧和真实 DJ 工作室照片作为生成参考，不直接复用原视频角色画面。

v3 进一步把视频帧人物的柔和半写实二次元画风作为主要风格参考，同时使用项目红莉栖立绘锁定角色身份，不直接复制视频角色的脸、服装或画面。
