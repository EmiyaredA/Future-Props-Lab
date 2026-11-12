<h1 align="center">Future Props Lab</h1>
<p align="center"><strong>未来道具研究所</strong></p>
<p align="center">把 AI 模型、创作工具和 Agent 放进同一个工作空间。</p>

<p align="center">
  <a href="#主要功能">主要功能</a> ·
  <a href="#平台能力">平台能力</a> ·
  <a href="#工坊一览">工坊一览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#文档">文档</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

Future Props Lab 是一个可自行部署的 AI 创作与协作平台。模型服务提供统一的多模态能力，文件库管理可复用素材，
各工坊承载图片、视频、故事、演示与知识创作；Amadeus 可以引用当前页面和项目上下文，结合工具协助完成工作。

你可以在创意工坊发现和分享能力，通过集成中心管理工具 API、MCP、Skill 与外部连接，
也可以用 Python SDK、CLI 或 MCP 编排自己的工作流。工具导航提供站内工具和外部工具入口，
云控则让获授权的管理员通过浏览器访问部署端的应用或桌面。

## 主要功能

| 能力 | 可以做什么 |
| --- | --- |
| **模型服务** | 统一配置文本、图片、视频、语音等模型，测试调用效果，查看调用日志与任务结果 |
| **Amadeus** | 引用页面、项目与选中对象，结合模型、Agent 和已授权工具协助创作 |
| **素材与能力复用** | 在文件库组织素材，在创意工坊发现、分享和安装工具能力与方案包 |
| **工具与集成** | 查找站内及外部工具，管理工具 API、MCP、Skill 和外部服务连接 |
| **云控** | 管理员按部署条件访问获授权的远程应用或桌面 |
| **视觉创作** | 在节点画布中组织提示词、参考素材与图片、视频生成任务 |
| **视频剪辑** | 使用多轨时间线编排素材、预览片段，导出片段或完整 MP4 |
| **Galgame 工坊** | 管理角色、场景、剧情、配音与音乐，预览和导出作品 |
| **录音标注** | 从语音识别结果开始，编辑分段、说话人和文本，导出标注数据 |
| **演示工坊** | 编辑幻灯片、表格、图表和动画，导入或导出可编辑 PPTX |
| **思绪工坊** | 用文件夹与文档组织知识，支持 Markdown、附件、LaTeX、Mermaid 和离线导出 |
| **3D 与特效** | 在导演台搭建场景与机位，在特效制作工坊编排图层和关键帧 |
| **自动化接口** | 通过 Python SDK、CLI 与 MCP 调用平台能力、管理项目和编排任务 |

各工坊共用文件库、账号体系与模型服务。私人项目和素材按账号隔离，管理员也不能浏览其他账号的私人项目。
模型供应商凭据由使用者自行配置，仓库不包含 API Key。

目前主要面向 **macOS 单机自部署**，通过浏览器使用，数据保存在本机。独立服务拆分正在推进，
完成全部切换门禁前，日常使用仍按下方网站入口启动；进展与部署边界见[独立服务迁移](docs/operations/independent-services.md)。

## 平台能力

从模型接入、素材管理到工具协作，各工坊共用同一套平台能力。以下为现有部署的真实界面，点击截图查看原图。

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/amadeus-assistant.jpg"><img src="docs/assets/readme/amadeus-assistant.jpg" alt="Amadeus：视觉工坊内的助手侧栏、项目上下文与能力快捷入口" width="100%"></a>
      <p><strong>Amadeus</strong><br>引用当前页面、项目与选中对象，结合工具协助创作。图中展示项目上下文和快捷入口。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/model-services.jpg"><img src="docs/assets/readme/model-services.jpg" alt="模型服务：接入连接、模型目录与多模态能力分类" width="100%"></a>
      <p><strong>模型服务</strong><br>配置供应商与接入连接，统一管理文本、图片、视频和语音模型，按协议与能力检索。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/model-playground.jpg"><img src="docs/assets/readme/model-playground.jpg" alt="模型测试：已有问候对话、模型选择、测试类型与生成参数" width="100%"></a>
      <p><strong>模型测试</strong><br>验证对话、图像、视频和语音能力，调整参数并查看历史结果。图中为已有文本测试。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/model-call-logs.jpg"><img src="docs/assets/readme/model-call-logs.jpg" alt="调用日志：网页会话的模型、Token 用量、耗时与成功失败状态" width="100%"></a>
      <p><strong>调用日志</strong><br>按来源、模型和状态筛选调用，查看 Token 用量、耗时与错误，辅助排查运行问题。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/creative-workshop.jpg"><img src="docs/assets/readme/creative-workshop.jpg" alt="创意工坊：创意广场的搜索、能力类型与发布入口，当前暂无公开创作" width="100%"></a>
      <p><strong>创意工坊</strong><br>在同一部署内发现、分享、安装和组合工具 API、MCP、Skill 与方案包。当前广场暂无公开作品。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/file-manager.jpg"><img src="docs/assets/readme/file-manager.jpg" alt="文件管理：新宿决战项目的视频素材缩略图、类型与文件大小" width="100%"></a>
      <p><strong>文件管理</strong><br>用文件夹统一组织图片、视频、音频与文档，预览素材并供工坊项目引用。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/tools-directory.jpg"><img src="docs/assets/readme/tools-directory.jpg" alt="工具导航：工具分类、站内视频工具与带外链标记的外部工具卡片" width="100%"></a>
      <p><strong>工具导航</strong><br>按分类查找站内的视频帧导出、视频下载；JSON、接口调试等带外链标记的卡片跳转外部网站。</p>
    </td>
    <td align="center" valign="top" width="50%">
      <a href="docs/assets/readme/integration-center.jpg"><img src="docs/assets/readme/integration-center.jpg" alt="集成中心：工具 API、MCP、Skill、外部连接分类与已有 Skill 版本列表" width="100%"></a>
      <p><strong>集成中心</strong><br>统一管理工具 API、MCP、Skill 与外部连接。图中为已有 Skill 的状态、标签和不可变版本。</p>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" colspan="2">
      <a href="docs/assets/readme/cloud-control.jpg"><img src="docs/assets/readme/cloud-control.jpg" alt="云控：Mac 远程应用选择与连接入口，当前未连接" width="49%"></a>
      <p><strong>云控</strong><br>管理员通过浏览器访问获授权的应用或桌面，取决于部署模式。<br>需配置主机服务与系统权限；公网访问还需显式授权和网络配置。图中为未连接状态。</p>
    </td>
  </tr>
</table>

云控的部署条件与权限边界见[云控说明](docs/reference/cloud-control.md)。截图来源、取景和校验值见[素材说明](docs/assets/readme/README.md)。

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
