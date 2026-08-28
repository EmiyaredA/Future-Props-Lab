# 《自由粒子的逃逸》演示维护工具

此目录只服务于可复现的 Galgame 演示内容，不是生产数据迁移入口，也不会在应用启动、安装或构建时
自动执行。除 `phone_overlay` 只处理显式输入/输出文件外，其余写操作都通过正式 `/v1` API 完成。

## 运行约束

- 从仓库根目录使用模块方式运行：`uv run python -m scripts.demo.galgame_runaway.<模块>`。
- 先在产品内创建短期 Management API Key，并仅为当前进程设置 `FPL_MANAGEMENT_API_KEY`；不要写入
  `backend/.env`、脚本、Shell 历史或文档。
- 项目 ID、素材根目录、标注文件和输出文件都必须显式传入。脚本不提供本机路径或项目 ID 默认值。
- `performance_upgrade` 同时需要 SG0 素材根目录和原作素材根目录；`--annotation` 必须指向经人工
  确认、校验值符合脚本审计约束的标注 JSON。
- API 脚本会在 `.runtime/galgame-import-backups/` 保存审计/回退快照，但运行前仍应按生产部署文档
  停止编辑并完成完整数据备份。

## 入口

| 模块 | 用途 | 必填目标参数 |
| --- | --- | --- |
| `performance_upgrade` | 上传演示素材、应用演出并执行审计 | action、`--project-id`、`--source-root`、`--original-source-root`、`--annotation` |
| `apply_cgs` | 只更新受管剧情 CG | `--project-id`、`--source-root` |
| `apply_transition_cards` | 只更新受管过场卡 | `--project-id` |
| `ground_portraits` | 立绘底边锚定与透明边距审计 | `--project-id` |
| `annotation_emotion_sync` | 同步广播剧标注与角色表情 | `--galgame-project-id`、`--annotation`、`--export` |
| `exports` | 提交并下载演示视频验收片段 | `--project-id` |
| `phone_overlay` | 从指定图集生成手机叠加图 | `--atlas`、`--output` |

例如：

```text
uv run python -m scripts.demo.galgame_runaway.exports submit \
  --project-id <project-id> --only random-sample
```

素材来源、许可状态、校验值和生产构建边界见 [`docs/assets/MANIFEST.md`](../../../docs/assets/MANIFEST.md)。
