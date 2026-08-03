# 项目结构

```text
Future-Props-Lab/
├── backend/app/
│   ├── core/          # 配置、数据库与密钥基础设施
│   ├── llm/           # 模型目录、供应商适配、诊断和调用日志
│   ├── models/        # SQLAlchemy 持久化形状
│   ├── routes/        # `/v1` HTTP 边界
│   └── schemas/       # Pydantic 请求与响应形状
├── db/migrations/     # SQLite 追加式迁移真源与校验器
├── web/src/
│   ├── app/           # Studio 入口、壳与路由
│   ├── docs/          # 独立空文档中心入口
│   ├── features/      # 模型服务与调用日志
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # API 与管理令牌基础设施
│   └── shared/        # 品牌与主题 UI
├── tests/             # 后端单元与 API 集成测试
└── scripts/           # OpenAPI 契约导出
```

前端 `platform` 与 `shared` 不依赖 `features`；业务页面不依赖 `app`。后端路由只负责协议映射，模型目录、供应商调用与日志查询分别保留在自己的能力模块中。

当前工程刻意不包含 Bot、会话、知识库、实时语音、扩展、多租户和用户权限表。

数据库是仓库根目录 `.runtime/future-props.db` 下的单机 SQLite 文件。FastAPI 启动时自动创建目录、执行带 checksum 的迁移，并为每个连接启用外键约束、WAL 与忙等待；目录 revision/CAS 和级联删除语义保持在存储层内。
