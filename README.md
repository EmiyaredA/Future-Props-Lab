<h1 align="center">Future Props Lab</h1>
<p align="center"><strong>未来道具研究所</strong></p>
<p align="center">把 AI 模型、创作工具和 Agent 放进同一个工作空间。</p>

<p align="center">
  <a href="#主要功能">主要功能</a> ·
  <a href="#工坊一览">工坊一览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#文档">文档</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

Future Props Lab 是一个可自行部署的 AI 创作与协作平台。你可以在浏览器里连接模型服务、组织素材，
制作图片与视频、编排 Galgame、编辑演示文稿和整理知识，也可以通过 Python SDK、CLI 或 MCP 将这些能力接入自己的工作流。

## 主要功能

| 能力 | 可以做什么 |
| --- | --- |
| **模型服务** | 统一配置文本、图片、视频、语音等模型，测试调用效果，查看调用日志与任务结果 |
| **视觉创作** | 在节点画布中组织提示词、参考素材与图片、视频生成任务 |
| **视频剪辑** | 使用多轨时间线编排素材、预览片段，导出片段或完整 MP4 |
| **Galgame 工坊** | 管理角色、场景、剧情、配音与音乐，预览和导出作品 |
| **录音标注** | 从语音识别结果开始，编辑分段、说话人和文本，导出标注数据 |
| **演示工坊** | 编辑幻灯片、表格、图表和动画，导入或导出可编辑 PPTX |
| **思绪工坊** | 用文件夹与文档组织知识，支持 Markdown、附件、LaTeX、Mermaid 和离线导出 |
| **Agent 与自动化** | 用 Amadeus 跨工坊处理项目，通过集成中心接入工具 API、MCP 和 Skill，或使用 SDK 编排任务 |

各工坊共用文件库、账号体系与模型服务。私人项目和素材按账号隔离，管理员也不能浏览其他账号的私人项目。
模型供应商凭据由使用者自行配置，仓库不包含 API Key。

目前主要面向 **macOS 单机自部署**，通过浏览器使用，数据保存在本机。独立服务拆分正在推进，
完成全部切换门禁前，日常使用仍按下方网站入口启动；进展与部署边界见[独立服务迁移](docs/operations/independent-services.md)。

## 工坊一览

八个工坊的真实工作界面。点击截图查看完整原图。

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/visual-workshop.jpg"><img src="docs/assets/readme/visual-workshop-preview.jpg" alt="视觉创作工坊：《石头门》新宿决战项目的分镜素材与节点连线" width="100%"></a>
      <p><strong>视觉创作工坊</strong><br>在画布中组织参考、分镜与生成任务。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/video-editor.jpg"><img src="docs/assets/readme/video-editor-preview.jpg" alt="视频剪辑工坊：石头门-新宿决战工程 00:36.049 的节目预览与多轨时间线" width="100%"></a>
      <p><strong>视频剪辑工坊</strong><br>用多轨时间线编排画面、字幕与声音。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/presentation-workshop.jpg"><img src="docs/assets/readme/presentation-workshop-preview.jpg" alt="演示工坊：PPT Agent 文稿第 7 页「大纲与模板选择」及编辑工作区" width="100%"></a>
      <p><strong>演示工坊</strong><br>排版文字与图形，制作可编辑演示文稿。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/director-desk.jpg"><img src="docs/assets/readme/director-desk.jpg" alt="3D 导演台：实验室预演项目的三维布景、机位监看与时间线" width="100%"></a>
      <p><strong>3D 导演台</strong><br>搭建三维场景，安排机位与演出时间线。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/galgame-workshop.jpg"><img src="docs/assets/readme/galgame-workshop.jpg" alt="Galgame 工坊：广播剧项目的剧本卡片与实时场景预览" width="100%"></a>
      <p><strong>Galgame 工坊</strong><br>编排剧情与场景，实时预览故事演出。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/audio-annotation.jpg"><img src="docs/assets/readme/audio-annotation.jpg" alt="录音标注工坊：广播剧项目的波形、说话人与多语言分段" width="100%"></a>
      <p><strong>录音标注工坊</strong><br>对照波形校对说话人、文本与情绪。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/thought-workshop.jpg"><img src="docs/assets/readme/thought-workshop.jpg" alt="思绪工坊：已导入官方指南的知识库首页编辑与文档目录" width="100%"></a>
      <p><strong>思绪工坊</strong><br>用知识库目录和富文本整理想法。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/motion-compositor.jpg"><img src="docs/assets/readme/motion-compositor.jpg" alt="特效制作工坊：怪盗风格片头草稿的图层时间线与二维动画预览" width="100%"></a>
      <p><strong>特效制作工坊</strong><br>编排图层、图形与关键帧，制作二维特效。</p>
    </td>
  </tr>
</table>

## 快速开始

### 环境要求

- Node.js **24**、npm **11+**
- Python **3.11+** 与 [uv](https://docs.astral.sh/uv/)
- Git 与 Git LFS
- FFmpeg / FFprobe，支持 H.264（libx264）与 AAC 编码

默认安装不下载本地大模型；使用远程模型需要自行准备相应供应商的凭据。

### 1. 获取代码并安装依赖

```sh
git lfs install
git clone https://github.com/EmiyaredA/Future-Props-Lab.git
cd Future-Props-Lab
npm run setup
```

如果检出时跳过了 LFS 下载，先执行 `git lfs pull`，再安装依赖。

### 2. 创建本地配置

以下初始化步骤用于**全新安装**。已有部署请沿用原配置、密钥和数据，升级前阅读[部署与恢复指南](docs/operations/production-deployment.md)。

```sh
cp backend/config.example.toml backend/config.toml
chmod 600 backend/config.toml
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

将生成的密钥填入 `backend/config.toml` 的 `[security].secrets_key`。密钥用于加密供应商凭据，
请与数据一起妥善保存。更多配置项见[配置说明](docs/reference/configuration.md)。

### 3. 初始化并启动

```sh
npm run db:migrate
npm run account -- create-admin --username admin
uv run python scripts/website/frontend.py
npm run dev
```

创建管理员时会输出一次性临时密码。打开 **[http://127.0.0.1:3000](http://127.0.0.1:3000)**，
使用该密码登录并立即改密，然后在「模型服务」中配置所需的供应商与模型。

- Studio：<http://127.0.0.1:3000>
- 使用文档：<http://127.0.0.1:3000/docs.html?page=overview>
- API 文档：<http://127.0.0.1:9001/docs>

配置默认保存在 `backend/config.toml`，数据库与素材默认保存在 `.runtime/`，两者均不提交 Git。
启动器只检查数据库迁移状态；已有部署的迁移、后台运行与公网访问请按[生产部署指南](docs/operations/production-deployment.md)操作。

## Python 自动化

独立 SDK 支持 Python 3.11+，可以在自己的 Python 环境中从仓库安装：

```sh
uv pip install ./sdk/python
fpl connect --url http://127.0.0.1:9001
```

客户端使用账号设置中创建的 Management API Key。安装说明、调用示例和错误处理见
[Python SDK](sdk/python/README.md)，完整工坊样例位于 `future_props_lab.workshop_examples`。

## 文档

| 想了解什么 | 从这里开始 |
| --- | --- |
| 使用各工坊 | 启动后的[文档中心](http://127.0.0.1:3000/docs.html?page=overview) |
| 配置模型与运行环境 | [配置说明](docs/reference/configuration.md) |
| 部署、升级、备份与恢复 | [生产部署](docs/operations/production-deployment.md) |
| 排查运行问题 | [故障排查](docs/operations/troubleshooting.md) |
| 使用 API 或 SDK | [API 参考](docs/reference/api.md) · [Python SDK](sdk/python/README.md) |
| 理解代码与扩展工坊 | [项目结构](docs/architecture/project-layout.md) · [Studio 框架契约](docs/architecture/studio-framework.md) |
| 了解账号与权限 | [账号与数据归属](docs/reference/account-governance.md) |

## 参与贡献

问题反馈与功能建议可以提交到 [Issues](https://github.com/EmiyaredA/Future-Props-Lab/issues)。
报告问题时，请附上复现步骤、运行环境和已脱敏的错误信息。

准备修改代码时，先阅读[贡献指南](CONTRIBUTING.md)与 [AGENTS.md](AGENTS.md)。
前端使用 React、TypeScript 与 Vite，后端使用 Python、FastAPI 与 SQLAlchemy，网站数据使用 SQLite。
常用开发命令如下，按改动范围选择对应检查：

```sh
npm run dev           # 启动本地 Studio
npm test              # 后端与 Web 测试
npm run lint          # 静态检查
npm run format:check  # 格式检查
npm run build         # 类型检查与前端构建
```

完整验证矩阵和公共契约的维护方式见[开发与验证流程](docs/operations/development-workflow.md)。

## 许可与素材

当前仓库尚未提供正式开源许可证，现有交付声明为“仅限内部开发交接，未授予再分发许可”。
素材、角色和第三方资产的来源及使用限制见[素材清单](docs/assets/MANIFEST.md)；该声明不替代后续由权利人确认的正式许可证。
