# 表格工坊工程说明

表格工坊以 FortuneSheet 1.0.4 的 MIT 开源源码作为浏览器编辑器，独立服务 ID 为 `spreadsheet`，入口为 `/apps/spreadsheet-workshop`。应用有自己的镜像、SQLite、迁移和原件目录；兼容网站只登记公共契约，不回退到网站数据库。

## 功能与边界

- 工作簿列表、搜索、分页、新建、复制、重命名、删除；多工作表、稀疏单元格、公式、字体、颜色、边框、合并、行列尺寸、冻结、排序和筛选由开源编辑器提供。
- 快照保留数据校验、条件格式、批注等原生配置；XLSX 转换仅支持显式映射的规则。暂不支持的导出规则返回 `unsupported_export_rule`，不会静默删除。
- 导入 XLSX、UTF-8/GB18030 CSV；先检查再确认有损内容，确认绑定预览 ID、原件 SHA-256 和转换器版本。预览一小时过期，原件随导入工作簿保留并受相同账号隔离。
- 导出 XLSX 或当前工作表 CSV；CSV 可选计算值或公式文本。计算值模式为可触发公式的文本加前导单引号。CSV 不承载样式和其他工作表。
- 每文件最多 20 MiB，XLSX 展开最多 100 MiB、10,000 个 ZIP 成员，工作簿最多 20 张表、100,000 个非空单元格、合计 1,000,000 个网格单元格。格式区域也受覆盖数量限制。
- 不实现实时协作、宏、图表、透视表、嵌入图片或外部数据连接。导入发现这些对象时展示损失提示；`.xls`、`.xlsm` 不接受。

公式由 FortuneSheet 在浏览器计算。Agent 写入公式后，工作簿为 `pending`；浏览器重算并保存后为 `browser_calculated`。这表示客户端缓存来源，不保证与 Excel 全部函数兼容。`pending` 的计算值 CSV 返回 409，公式 CSV 可导出。XLSX 保留公式、清除计算缓存，并要求 Excel 打开时完整重算。命名区域、特殊数组公式、部分扩展公式和混合文字样式的导入存在明确提示的转换损失。

## 保存与恢复

更新和删除必须提供 `expected_revision`，写入附带稳定的 `request_id`。服务在同一事务内完成 CAS 更新和回执；同一请求重试返回原结果，不同输入复用请求 ID 返回 409。浏览器串行保存，确认丢失时先重试原请求，再写入后续草稿。冲突时停止自动保存，提供重新加载与另存副本，离开前检查未保存内容。

原件先以不可预测的键写入私有目录并 fsync，再记录元数据。取消转换时等待阻塞任务退出；提交结果未知时不删除可能已引用的文件。启动恢复只收集无持久引用的原件。已过期但未确认的预览及操作回执当前保留在所属服务数据库中，不提供用户历史版本界面；运行时需纳入容量监测和所属服务备份。

## 独立构建与部署

```sh
npm run services:build:web -- spreadsheet
npm run services:build -- spreadsheet --web-release .local/service-web/spreadsheet/BUILD_ID --build
```

`.local/` 中输出仅用于构建验收。正式发布按[生产部署](../operations/production-deployment.md)把镜像、登记和持久状态放在正式 `.runtime/` 根目录，使用 `deploy/compose/spreadsheet.compose.yaml`，设置 `FPL_SPREADSHEET_IMAGE` 与 `FPL_SPREADSHEET_STATE`。只挂载本服务状态和 Identity 公钥，不挂载其他应用数据库。

首次初始化通过所属镜像执行 `migrate`；`serve` 不自动迁移。`/health` 表示进程存活，`/ready` 同时要求迁移匹配、恢复完成、数据库可读、浏览器资源与 API 指纹一致。默认独立 Compose 限制为 1 CPU、768 MiB、只读根文件系统，服务状态单独挂载。Gateway 的精确路由和 Identity 权限由登记清单生成。

## 自动化接口

11 项操作登记在公共 automation manifest，并生成 `client.spreadsheet` / `AsyncClient.spreadsheet`，CLI 和 MCP 使用相同清单发现。包括列表、创建、读取、快照更新、删除、原子批量操作、区域读取、导入预览/确认、下载原件及导出。

`apply_operations` 支持 `set_cells`、`clear_range`、`style_range`、`add_sheet`、`rename_sheet`、`delete_sheet` 和 `reorder_sheets`。所有操作在一份副本上校验后原子提交；重命名和删除更新普通跨工作表引用，不能安全处理的三维引用明确拒绝。区域采用 A1 写法，单次最多 10,000 单元格。账号来自已验证的 Identity 上下文，管理员同样不能访问其他账号工作簿。

批量操作累计单元格扫描与修改最多一百万次，格式展开的估算体积最多 20 MiB；超过时应读取最新版本并拆成较小批次。XLSX 在创建工作簿对象前流式检查单元格、共享文字、样式及坐标数量，避免小型压缩文件绕过内存限额。

## 来源与验证

FortuneSheet 源码和 MIT 许可证见 `vendor/fortune-sheet/README.md`、`LICENSE`；含编辑器的浏览器发布包携带 `assets/fortune-sheet-LICENSE.txt`。仅注册中文和英文语言以满足构建预算，其他语言源码保留。源码进入构建输入哈希。共享 Pixi 渲染代码按依赖图的强连通分量拆包，构建检查同时验证大小和静态依赖无环。

头像由内置 ImageGen 根据现有应用徽章生成，使用红莉栖女仆形象、蓝眼睛、栗红长发、铜色齿轮、暖桃色背景和表格道具，无文字。正式源图在 `web/public/brand/spreadsheet-workshop-mark.png`，64/128/256 WebP 由统一工具生成。

验证入口：`tests/apps/spreadsheet_workshop/`、`tests/integration/test_independent_spreadsheet.py`、`web/tests/features/spreadsheet-workshop/`、`web/e2e/spreadsheet.spec.ts`。浏览器测试使用真实开源编辑器与隔离测试账号，持久协议由独立服务测试验证。

## 当前环境

2026-11-16 已部署至当前独立环境。应用列表可打开 `/apps/spreadsheet-workshop`，沿用现有登录身份。表格状态目录为 `.runtime/independent-services/targets/spreadsheet/`；正式网页、主机副本、发布计划及核验结果保存于 `.runtime/deployment/releases/spreadsheet-20261116/`，必要回退材料保存于 `.runtime/deployment/recovery/spreadsheet-20261116/`。本机与公网均核验通过，既有业务数据库未执行迁移。
