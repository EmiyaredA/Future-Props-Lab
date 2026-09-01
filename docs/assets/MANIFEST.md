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
| `docs/assets/galgame-runaway-cgs/` | 70 | 《自由粒子的逃逸》演示 CG 与历史版本 | ImageGen 生成/编辑，部分以项目内原作画面和角色素材为参考；新增副本逐项记录见同目录 README | 未提供独立再分发授权；仅限内部开发交接 | `9cc34a820d7407dad423695a369d682a376da6c139bd67a1b118655dc3083562` | 否 |
| `docs/assets/galgame-runaway-portraits/` | 18 | 演示角色口型与半身立绘 | 原作素材的裁切/整理版本 | 仓库未包含上游许可；不得独立再分发 | `03badb7acdd1921374a7f3174a276af6230a33be8850d4141c5d49370ea84247` | 否 |
| `docs/assets/galgame-runaway-scenes/` | 2 | 演示场景背景 | 原作素材的演示处理版本 | 仓库未包含上游许可；不得独立再分发 | `54e41702b90f5f2c529f55a721e1fb9df1f69ba425bc5262768b49259a516d9b` | 否 |
| `docs/assets/galgame-ui/` | 15 | 对话框、日期板、手机和开场 UI 演示 | ImageGen 生成物及原作图集的局部重组；详细来源见同目录 README | 混合来源且无统一再分发授权；仅限内部演示 | `d099ec496179aca256818a087923c82a86ede1ebebfe3bb118ab8ce9c561b674` | 否 |
| `docs/assets/kurisu-lab-music/` | 18 | 视觉探索、动作帧和生成参考 | 项目角色/场景、B 站参考视频帧、Unsplash 参考照片及生成结果；详见同目录 README | 混合第三方参考；发布前需逐项复核来源条款 | `2c544c9f922e11a8e2512e01e91544c6914f0a7fdc06370bfe98d9169a1ad992` | 否 |
| `docs/assets/runaway-pilot-rev33/` | 12 | 历史预演验收截图 | 本项目播放器对演示数据的截图 | 未单独授权；仅作项目内回归证据 | `2df129d81a52a5e0eca0a680e3497002362c03fc3ac274ba60a135d25e5790f0` | 否 |
| `docs/*.png` | 9 | 功能界面和交付文档截图 | 本项目 Web UI 截图 | 未单独授权；仅作项目文档 | `4fda1e4b613ee9e2016b914858ee987b829cf885361140832ffa2d913028ec02` | 否 |
| `web/public/docs/` | 10 | 应用内文档中心界面截图 | 确定性 Chromium 旅程生成的本项目 Web UI 截图 | 未单独授权；仅限内部开发交接 | `db5e4b5e6affe717fd20ed46725f121f8441ab79d17452eabed5a3d0b704b585` | Web 文档中心 |

## 生产运行资产

这些文件也由 Git LFS 管理，但会被对应 CI Job 选择性下载。`scripts/check_lfs_assets.py` 在安装和构建
入口检查 Git LFS、对象物化状态与下列校验值。

| 文件 | 用途 | 来源与版本 | 许可证 | SHA-256 | 生产构建 |
| --- | --- | --- | --- | --- | --- |
| `backend/app/galgame_workshop/assets/NotoSansSC-Regular.ttf` | 确定性中文对白渲染 | Noto Sans SC 固定字体 | SIL OFL 1.1，见同目录 `OFL.txt` | `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b` | 后端需要 |
| `backend/app/galgame_workshop/assets/NotoSansSC-Medium.ttf` | 确定性中文标题渲染 | Noto Sans SC 固定字体 | SIL OFL 1.1，见同目录 `OFL.txt` | `ca094f6b0001fb048ca39ddd797a0cdb0179e1e55c6561e111c49c3e6a61d7b7` | 后端需要 |
| `web/public/voice-vad/silero_vad_v5.onnx` | 浏览器实时语音 VAD | `@ricky0123/vad-web@0.0.30` 随包模型 | npm 包声明 ISC；对外再分发前仍应核对模型上游条款 | `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f` | Web 需要 |
| `web/public/voice-vad/ort-wasm-simd-threaded.wasm` | 浏览器 ONNX Runtime | `onnxruntime-web@1.27.0` | MIT | `d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6` | Web 需要 |

## LFS 边界

本次迁移不改写既有 Git 历史，只把当前分支上的文件和未来增量改为 LFS 指针。因此旧提交中的二进制
对象仍会保留在 Git 历史中，仓库体积不会立即下降。新增或替换素材后，应更新本清单的数量/校验值，
并运行 `npm run lfs:check:pointers`、`npm run lfs:check` 和 `git lfs fsck`。
