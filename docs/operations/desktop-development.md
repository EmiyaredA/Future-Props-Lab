# 桌面热加载开发

日常修改不用重新制作 DMG。先安装开发依赖（`npm run setup`），在仓库根目录运行：

```sh
npm run dev:desktop       # 独立开发数据
npm run dev:desktop:live  # 正式 App 的账号、作品、素材与配置
```

两条命令都使用源码、Vite、本机 Node.js 和 `.venv`；不是独立安装包。只有需要交付/替换安装包时
才运行原有 `npm run build:desktop` / `npm run package:desktop`。
普通 Web `npm run dev` 的行为不变。

## 更新如何生效

| 修改 | 生效方式 |
| --- | --- |
| CSS、兼容的 React 组件 | Vite HMR 即时更新，保留兼容组件状态 |
| 需要整页重载的前端变更 | 进入待更新状态；点击“应用更新”，通过未保存导航保护后刷新 |
| Python 后端 | 自动语法检查，手动应用时仅重启后端；保持窗口、地址与页面内存 |
| Electron 主进程 / preload | 自动编译到独立暂存目录；手动应用后重启 Electron 并恢复主页面路径 |
| App `backend/config.toml` | 自动校验；手动应用前停止后端，备份运行数据与最近成功配置 |

窗口底部标明“开发模式 · 正式数据”或“开发模式 · 开发数据”，显示检查失败、待应用与完成状态。
编译失败不会切换运行中的 Electron/preload。Python 检查不执行模块；导入或运行时错误仍可能在启动时
出现，页面提供检查/重试。连续改动合并检查，应用过程中发生的新改动仍保留为下一次待更新。
启动器本身、依赖或 Vite 配置改变后需要正常退出再启动，不承诺这些引导层文件自身热替换。

整页/主进程更新复用项目的未保存提示，取消不会开始更新。后端更新不卸载页面：普通列表恢复后刷新
查询；已注册编辑保护的页面保留草稿与原 revision，提示保存后重新进入获取最新数据。
保存仍经原有 CAS 校验，409 冲突交由原有界面处理。
更新可能中断后台生成、SSE 或实时语音，请先结束重要任务；不自动重试写请求或模型提交。

关闭窗口只是隐藏，Dock 可重开。通过菜单或 ⌘Q 正常退出；终端 Ctrl+C 也只发送正常退出请求，
取消未保存提示时开发进程继续运行。启动器异常退出后，子进程通过 IPC/管道断开清理后台进程。

## 正式数据边界与备份

live 固定使用 `~/Library/Application Support/Future Props Lab/`，普通开发固定使用同级
`Future Props Lab Development/`；两者不读取仓库数据/配置，也不会复制或合并数据库。
正式 App 正在运行时，live 启动器通过已授权的 AppleScript 方式请求正常退出；取消或超时就停止切换，
不强退。启动器先拿开发实例锁再拿后端数据锁；重复开发启动不会再请求退出已运行实例。
同一数据目录在后端与 Electron 重启交接期间始终持锁。

首次 live 启动在停机持锁状态下，备份完整 `runtime/` 和 `backend/` 到同级：

```text
Future Props Lab Development Backup YYYYMMDD-HHMMSS-随机后缀/
  runtime/               原数据库、SQLite 日志、所有素材和辅助文件
  backend/               TOML 与原有配置备份
  manifest.json          runtime 文件数量、大小、SHA256
  config-manifest.json   配置文件大小与 SHA256（不含配置内容）
  complete.json          校验通过标记与来源
```

同卷 APFS 优先使用写时复制克隆；不支持克隆时检查空间后完整复制。备份目录 0700，配置文件 0600。
校验所有文件摘要、数据库完整性与外键，不丢弃 SQLite 日志。SQLite 完整性检查使用额外临时副本，
避免检查自身改变备份清单。外部符号链接阻止备份，必须先核清依赖。
`development/baseline.json` 记录首次成功备份路径，普通代码/HMR 更新不再复制全部素材。
`development/last-success-config.toml` 保存最近成功加载的配置；配置变化时另做停机快照，旧密钥不可更换。
这些文件含有密钥，TOML 不代表加密；不要上传或放入 Git。

每次启动和应用更新都只读核对已登记迁移 ID、顺序和 checksum。存在新增迁移、缺失迁移、未知版本或
漂移时停止操作，不通过热加载自动修改正式 schema。先在隔离数据库完成项目规定的 migration 验证，
经正常备份及正式迁移流程处理，再重新启动 live。全新独立开发目录允许正常首启建库。

### 明确恢复步骤

恢复不自动执行，也不删除失败现场：

1. 正常退出开发窗口及正式 App，确认数据锁空闲。
2. 选定已带 `complete.json` 的正确备份，核对来源、清单和时间，确认回退后的数据时间点。
3. 将当前 `runtime/` 和 `backend/` 重命名为带时间戳的失败现场，保留其他目录和浏览器缓存。
4. 从同一备份成对复制 `runtime/` 与 `backend/` 回原位，保持配置 0600；不可只恢复数据库或只换密钥。
5. 使用与备份迁移版本兼容的源码或已安装 App 启动。不要更改迁移记录来绕过检查。

恢复前需要用户明确选择快照；此操作会回到快照时间点，之后的数据保存在失败现场中。
业务数据修复/导入/删除仍只能通过正式 `/v1` API 或 CLI。

## 接入与安全

Electron 开发网关仅监听 `127.0.0.1`。每次 Electron 启动生成私有凭据，由主进程注入 HTTP 与 WebSocket；
渲染器、URL 和日志不含私有凭据。无凭据、错误 Host/Origin 被拒绝。固定目标为 Vite 或当前后端，
转发时重写内部 Host/Origin，保留业务 Cookie/CSRF；后端更新期间 API 返回 503。
Vite 仅提供源码/HMR，不代理业务 API，并禁止读取配置、`.env`、运行数据及开发缓存。
不要将内部 Vite 地址作为普通浏览器的业务入口。

CLI/SDK 仍使用正式 Agent 授权与 Unix Socket；更新前暂停通道，后端恢复后重新发布连接描述。
原有 API Key 有效期不变，内存配对/打开请求失效，需要重发。文档窗口、下载和麦克风权限沿用固定来源校验。
打包 App 不启用开发能力，即使继承开发环境变量也不会启动网关；源码监督器和开发编译快照不打包。

## 自动验证

```sh
npm run test:desktop
npm run test:desktop:dev
npm run test --workspace web -- tests/desktop-development.test.tsx
```

真实 Electron 烟测仅创建临时测试目录、账号和独有源码探针，验证完成后清理；禁止指向正式数据。
`--test-data-dir` / `--test-port` 仅为隔离烟测提供调试入口，不能与 `--live` 同用；正式 live 不开放调试端口。
模型提交不属于该烟测，不发起付费调用。
