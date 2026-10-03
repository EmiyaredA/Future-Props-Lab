# 仓库素材清单

本清单区分“文档/演示素材”和“生产运行资产”。本次交付仅限内部开发交接，不授予任何素材的
再分发许可。未在许可证栏明确标注可再分发的文件，不得因为其已进入仓库就推定拥有公开发布、商用
或再许可权；对外交付前应由素材所有者完成权利复核。

## 文档与演示素材

下表的内容集校验值按以下规则生成：对组内图片按仓库相对路径排序，为每个文件生成标准
`SHA-256  路径` 行，再对完整行集计算一次 SHA-256。README 和提示词等文本不计入图片数量与校验值。
`docs/assets/` 与 `docs/*.png` 通过 Git LFS 保存，均不参与后端或 Web 生产构建，CI 默认不下载；
`web/public/docs/` 是文档中心运行时截图，作为普通 Web 静态资产参与构建。检查脚本可对实体文件使用
SHA-256，也可在跳过 LFS 下载的检出中使用指针 OID，避免把指针文本误当作图片内容。

| 路径范围 | 数量 | 用途 | 来源 | 许可证/分发状态 | 内容集 SHA-256 | 生产构建 |
| --- | ---: | --- | --- | --- | --- | --- |
| `docs/assets/galgame-runaway-cgs/` | 68 | 《自由粒子的逃逸》演示 CG 与历史版本 | ImageGen 生成/编辑，部分以项目内原作画面和角色素材为参考；新增副本逐项记录见同目录 README | 未提供独立再分发授权；仅限内部开发交接 | `44d068f64f01b8c2fc61f196df9ec4846046c32a8b68dbcdaf62e96ab91d2d36` | 否 |
| `docs/assets/galgame-runaway-portraits/` | 18 | 演示角色口型与半身立绘 | 原作素材的裁切/整理版本 | 仓库未包含上游许可；不得独立再分发 | `03badb7acdd1921374a7f3174a276af6230a33be8850d4141c5d49370ea84247` | 否 |
| `docs/assets/galgame-runaway-scenes/` | 2 | 演示场景背景 | 原作素材的演示处理版本 | 仓库未包含上游许可；不得独立再分发 | `54e41702b90f5f2c529f55a721e1fb9df1f69ba425bc5262768b49259a516d9b` | 否 |
| `docs/assets/galgame-ui/` | 15 | 对话框、日期板、手机和开场 UI 演示 | ImageGen 生成物及原作图集的局部重组；详细来源见同目录 README | 混合来源且无统一再分发授权；仅限内部演示 | `d099ec496179aca256818a087923c82a86ede1ebebfe3bb118ab8ce9c561b674` | 否 |
| `docs/assets/kurisu-lab-music/` | 18 | 视觉探索、动作帧和生成参考 | 项目角色/场景、B 站参考视频帧、Unsplash 参考照片及生成结果；详见同目录 README | 混合第三方参考；发布前需逐项复核来源条款 | `2c544c9f922e11a8e2512e01e91544c6914f0a7fdc06370bfe98d9169a1ad992` | 否 |
| `docs/assets/runaway-pilot-rev33/` | 12 | 历史预演验收截图 | 本项目播放器对演示数据的截图 | 未单独授权；仅作项目内回归证据 | `2df129d81a52a5e0eca0a680e3497002362c03fc3ac274ba60a135d25e5790f0` | 否 |
| `docs/*.png` | 9 | 功能界面和交付文档截图 | 本项目 Web UI 截图 | 未单独授权；仅作项目文档 | `4fda1e4b613ee9e2016b914858ee987b829cf885361140832ffa2d913028ec02` | 否 |
| `web/public/docs/` | 42 | 文档中心真实操作截图，逐图场景见同目录 sources.json | 隔离数据库、正式 API、真实 Chrome/Electron；合成媒体与自写 Skill，模型响应为确定性示例 | 本项目 UI 截图，沿用仅限内部开发交接声明 | `2d0bd24e325b0a7ff5b3cfdc467e6089455b888a854fe85c2a16091b5293a683` | Web 文档中心 |

| `docs/assets/video-editor-text-*.png` | 4 | 视频剪辑文字功能的四张交互设计图 | ImageGen，参考用户提供的现有界面截图；参见 [设计说明](video-editor-text.md) | 含原项目素材缩略图，仅限内部设计参考 | `25f488a9f3be63629f37b4d3e9c9c74820a7f351a3a689ef207205cc2f8b90d9` | 否 |

## 生产运行资产

这些文件也由 Git LFS 管理，但会被对应 CI Job 选择性下载。`scripts/check_lfs_assets.py` 在安装和构建
入口检查 Git LFS、对象物化状态与下列校验值。

| 文件 | 用途 | 来源与版本 | 许可证 | SHA-256 | 生产构建 |
| --- | --- | --- | --- | --- | --- |
| `web/public/brand/amadeus/amadeus.fpllive2d` | Amadeus 内置只读案例与动态头像的 FPL 原生工程 | 用户选定的角色原画，经确定性分层、骨骼和网格打包；[制作说明](amadeus-native-avatar.md) | 仅限内部开发交接，角色无独立再分发授权 | `9cd9d77c781fbe6d96e878cd48a5ac0709deeeb2b7e5ac876bc3d44d0ca97aac` | Web 需要 |
| `web/public/brand/amadeus/amadeus-poster.png` | 头像相机位定帧回退 | 从同一 `.fpllive2d` 工程确定性渲染；[制作说明](amadeus-native-avatar.md) | 同上 | `80cd7211b946667667dc527536b25a8dee536896e887dcae1d280c20e524f441` | Web 需要 |
| `web/public/brand/amadeus/amadeus-stage-poster.png` | 半身舞台相机位定帧回退 | 从同一 `.fpllive2d` 工程确定性渲染；[制作说明](amadeus-native-avatar.md) | 同上 | `59baef48c4953e79f32fcbc9c86e9306fecb65ae554e50349048c41c3ab17465` | Web 需要 |
| `backend/app/capabilities/media_rendering/assets/NotoSansSC-Regular.ttf` | 确定性中文对白及剪辑文字渲染 | Noto Sans SC 固定字体 | SIL OFL 1.1，见同目录 `OFL.txt` | `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b` | 后端需要 |
| `backend/app/capabilities/media_rendering/assets/NotoSansSC-Medium.ttf` | 确定性中文标题渲染 | Noto Sans SC 固定字体 | SIL OFL 1.1，见同目录 `OFL.txt` | `ca094f6b0001fb048ca39ddd797a0cdb0179e1e55c6561e111c49c3e6a61d7b7` | 后端需要 |
| `web/public/brand/thought-workshop-mark.png` | 思绪工坊应用卡片、侧栏及最近访问头像 | 内置 ImageGen 生成，菲莉丝角色与既有工坊徽章为参考；[来源与提示词](thought-workshop-avatar.md) | 原作角色无独立再分发授权，沿用内部开发交接范围 | `4706bb94b1d94898ea52f63dfa5167cbda9ad34fe55a25857a4ed9b1e49a12c9` | Web 需要 |
| `web/public/brand/presentation-workshop-mark.png` | 演示工坊应用卡片、侧栏及最近访问头像 | 内置 ImageGen 生成，琉华子角色与既有工坊徽章为参考；[来源与提示词](presentation-workshop-avatar.md) | 原作角色无独立再分发授权，沿用内部开发交接范围 | `34895e659c9406789e9cadfe7aab0ea42f86ea3d55e868718d9714bec06357ec` | Web 需要 |
| `web/public/brand/audio-annotation-mark.png` | 录音标注工坊应用卡片、侧栏及最近访问头像 | 内置 ImageGen 生成，萌郁角色与既有工坊徽章为参考；[来源与提示词](audio-annotation-avatar.md) | 原作角色无独立再分发授权，沿用内部开发交接范围 | `a3539f2db85bdc42fdfab5dea9215b3ef1ce4e1c560bc9834d5c30feae015349` | Web 需要 |
| `web/public/brand/director-desk-mark.png` | 导演台应用卡片、侧栏及最近访问头像 | 内置 ImageGen 生成，冈部伦太郎角色与既有工坊徽章为参考；[来源与提示词](director-desk-avatar.md) | 原作角色无独立再分发授权，沿用内部开发交接范围 | `fec866de8e555d43d4faa4ae818bae1725b2cfc106e79affa6be2646c4235ee0` | Web 需要 |
| `web/public/brand/desktop-pet-mark.png` | 桌宠工坊应用卡片、侧栏及最近访问头像 | 内置 ImageGen 生成，参考视觉创作工坊，女仆装红莉栖配桌面窗口、爪印与爱心；[来源与提示词](desktop-pet-avatar.md) | 原作角色无独立再分发授权，沿用内部开发交接范围 | `09ba7ae71ca38a5ee2f56b68aa44b8d330b386501d621929b2ad2d1faa8306b4` | Web 需要 |
| `web/public/voice-vad/silero_vad_v5.onnx` | 浏览器实时语音 VAD | `@ricky0123/vad-web@0.0.30` 随包模型 | npm 包声明 ISC；对外再分发前仍应核对模型上游条款 | `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f` | Web 需要 |
| `web/public/voice-vad/ort-wasm-simd-threaded.wasm` | 浏览器 ONNX Runtime | `onnxruntime-web@1.27.0` | MIT | `d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6` | Web 需要 |

## LFS 边界

本次迁移不改写既有 Git 历史，只把当前分支上的文件和未来增量改为 LFS 指针。因此旧提交中的二进制
对象仍会保留在 Git 历史中，仓库体积不会立即下降。新增或替换素材后，应更新本清单的数量/校验值，
并运行 `npm run lfs:check:pointers`、`npm run lfs:check` 和 `git lfs fsck`。

Amadeus 的选定原画和去表情底画保存在 `web/src/features/amadeus/art/`，同样由 Git LFS 管理，但不进入 Web 运行包。它们的 SHA-256 分别为 `c174be887d90addc18099cc1362ff448c7beb339f62e3ccd4b5e98e3118ba467` 和 `31e77fac842319b0ec96ce73b481c7e295d9732e88c5899044a46080c2d59c0d`。

分层绑定审阅草案的两张隐藏补画也保存在同目录，由 Git LFS 管理，不进入 Web 运行包：`kurisu-under-hair.png` SHA-256 `6ea84e257b6c97002dce5a1f6ee734b9a33270fd5dbf08dcf98b35b037392b75`，`kurisu-hands.png` SHA-256 `f6fb87df1f4da430528c5aece4530211404cffdd79e1a6e20bb82ae6d9318dd1`。[来源、生成提示词和使用范围](amadeus-rig-review.md)。

## Live2D 工坊头像

- `web/public/brand/live2d-workshop-mark.png`：Live2D 工坊卡片、侧栏与项目入口共用；内置 ImageGen，参考现有徽章与用户指定 Amadeus 形象。[来源与提示词](live2d-workshop-avatar.md)。沿用内部开发交接范围。SHA256：`e8b8839472bdfc9923aba39987568392d0619ad834e41b7c96cd039352d6eecd`。
