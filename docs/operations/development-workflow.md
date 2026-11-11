# 开发与验证流程

在仓库根目录执行命令。准备环境和依赖版本见[贡献指南](../../CONTRIBUTING.md)，正式服务见[生产部署](production-deployment.md)。

## 本地运行与配置

- 用 `npm run setup` 安装后端和 Web 依赖。用 `npm run dev` 启动整套 Studio。`npm start`、`dev:backend` 和
  `dev:web` 进入同一开发启动器。日常开发读取已有的 `backend/config.toml` 和 `.runtime/`，前端固定回环 3000，后端固定回环 9001。
  自动测试必须显式使用隔离配置、数据库和素材，禁止读取现有数据。
- 后端持久配置只放在 `backend/config.toml`，按分组使用 TOML 原生类型。进程环境变量可供测试和部署覆盖。
  `.env` 只用于一次性转换，成功后归档为 0600 备份，后续运行只读取 TOML 与允许的环境变量。
  配置格式和转换模块 `backend/studio/config/` 独立于业务应用与数据库。
- 修改安装、启动、环境变量、依赖或目录路径时，同步检查根与 Web 的 `package.json`、
  `pyproject.toml`、脚本、README 和 CI/测试入口。
- `scripts/demo/` 只保存内容专用演示维护工具；必须通过正式 API 操作，并要求调用者显式提供项目 ID、
  素材根目录和输入/输出路径，不得保存本机绝对路径或默认目标项目。
- 仓库二进制资产使用 Git LFS。缺少对象时按路径选择性执行 `git lfs pull`，先核实对象再使用字体、模型和图片。
  新增或替换 `docs/` 图片、固定字体或 VAD 二进制时同步更新 `docs/assets/MANIFEST.md`，并执行 `git lfs fsck`。
  演示素材只有在核清来源和许可证后才可再分发。

## 公共契约与 SDK

- Python SDK 位于 `sdk/python/`，独立于后端运行时。Web 和 SDK 的生成契约由 OpenAPI 与登记的操作清单生成，禁止手工改生成文件。
  契约生成与服务契约读取归 `scripts/contracts/`。资产和文档保护检查归 `scripts/checks/`。
- HTTP 或 SSE 契约变更应同步后端 schema 与路由、OpenAPI 生成物、Web 和 SDK 消费端、API 参考及契约测试。
  用 `npm run contracts:check` 核验生成物，`npm run sdk:check` 单独核验 SDK 及其文档参考。具名方法覆盖与业务闭环分别验证。
- `npm run contracts:generate` 经 `sdk:generate` 执行 `scripts/generate_sdk_docs.py`，可能写入受保护的 `web/src/docs/`。
  涉及产品 API 参考的生成和提交须按[产品文档中心保护规则](agent-notes.md#受保护的产品文档中心)处理。
  仅更新工程契约时，按下列顺序调用现有子命令。若检查发现产品参考过期，记录差异，由有产品文档更新授权的改动同步。

  ```sh
  uv run python scripts/contracts/export_openapi.py
  uv run python scripts/contracts/generate_avatar_contract.py
  npm run contracts:generate --workspace web
  uv run python scripts/contracts/generate_sdk.py
  npm run services:contracts:generate
  ```

## 验证矩阵

- 后端测试按 `tests/{architecture,apps,contracts,runtime,host,integration}/` 归类。Web 测试按
  `web/tests/{features,shared,platform}/` 归类，浏览器旅程归 `web/e2e/`。受保护产品文档直接引用
  的测试证据保留原路径。可自动化验证的行为应由自动测试覆盖。
- 架构测试覆盖依赖方向、迁移独立性、路由版本和核心目录。变更架构规则时，同步维护对应契约、目录索引和测试。
  规则入口或适用范围有变化时同步维护根 `AGENTS.md`。
- 新增 Web 路由或独立 HTML 入口时，同步更新 `web/e2e/responsive-inventory.ts` 与相应适配用例；
  页面不得依靠根级隐藏横向溢出来通过检查，复杂区域使用明确的局部滚动和可点击操作入口。
- 界面控件统一使用项目自绘外观与弹层。下拉菜单、颜色与日期选择等适配明暗主题。
  原生 `select`、`input[type="color"]` 和 `input[type="date"]` 只可作为完全隐藏的底层能力。
  新增或修改页面时检查键盘操作、焦点和无障碍标签。
- 按改动范围选择下表检查。供应商相关测试使用确定性适配器。需要真实凭证的验证无法执行时，报告缺项和原因。
  确定性测试禁止依赖真实供应商请求。

| 范围 | 命令 |
| --- | --- |
| Python 与 Web 测试 | `npm test` |
| 浏览器端到端旅程 | `npm run test:e2e` |
| 静态检查和格式 | `npm run lint`、`npm run format:check`。需要格式化时用 `npm run format` |
| 契约一致性 | `npm run contracts:check` |
| 类型和构建预算 | `npm run build` |
| LFS 指针和运行资产 | `npm run lfs:check:pointers`、`npm run lfs:check` |
| Agent Note 与文档中心保护 | `npm run verify-notes`、`npm run check-docs-center-protected` |

## 源码体量与命名门禁

- 单文件门禁为生产 Python 900 行、TS/TSX 1000 行、CSS 800 行。检查覆盖 `backend/studio/`、`web/src/` 和
  `scripts/website/`，排除 `web/src/generated/`。测试文件门禁为 `tests/`、`web/tests/`、`web/e2e/` 中
  的 Python、TS、TSX 每文件 1200 行。超限按语义拆分。
- 目录门禁对 `backend/studio/` 每层目录直接持有的上述类型文件求和，上限 6000 行。
  [架构测试](../../tests/architecture/test_repository.py)也列有旧的 Web 和后端根路径，仅在路径实际存在时检查。
  该门禁目前没有扩展到 `web/src/features/`。
- 目录门禁的覆盖范围内禁止 `-foundation`、`-components`、`-interactions`、`-part\d*`、`-base`、`-extra`
  和 `-misc` 后缀，以及只做转发的空壳 `@import` 样式。禁止在 Web 源码新增编号式 CSS 分片。
  构建预算脚本只读产物，禁止在构建后拆分或改写 CSS。

## RelayVSR 本机验收

RelayVSR 2× INT8 的桌面入口通过本机证据启用。构建时使用 Apple Silicon 上的 Xcode Command Line Tools 和 CMake，执行环境还需要可从 PATH 调用的 `ffmpeg` 与 `ffprobe`。临时权重、构建产物和验收报告放在经 `git check-ignore` 核验的 `.local/` 任务目录。

1. 检出 `stable-diffusion.cpp` 的 `a3c49b13be5a64a0b4da2b576af3a17e8ae1ccbf`，按该提交初始化子模块。
2. 以 `backend/studio/host/local_models/relayvsr` 为 CMake 源目录，传入 `-DRELAYVSR_SOURCE=<上游源码绝对路径>` 和 `-DCMAKE_BUILD_TYPE=Release`，构建 `fpl-relayvsr` 目标。
3. 按本地模型清单取得两份 RelayVSR 权重。在实际 Mac 桌面环境运行 `uv run python scripts/validate_relayvsr.py benchmark --executable <worker> --weights <权重目录> --input <768p样片> --output <验收目录>`。脚本会校验版本、权重和输出，保存逐帧对比及进程内存采样。
4. 看完对比视频并确认通过后，运行 `uv run python scripts/validate_relayvsr.py publish --executable <worker> --reviewed-report <验收目录/result.json> --local-model-root <部署的local-models目录>`。该操作发布运行环境及验收证明。随后在本地模型页安装、启用并接入当前空间。可传入 `--weights <权重目录>` 预置已校验的下载缓存。模型文件仍由应用安装流程校验和管理。
