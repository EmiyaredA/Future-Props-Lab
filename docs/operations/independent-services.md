# 独立服务迁移与隔离验证

本轮正在把网站单体迁为同仓库的独立服务。正式网站仍由网站入口运行；未完成所有服务、数据导入与恢复验收前，不停止正式实例，不连接或迁移正式数据库。

## 已实现的运行边界

Identity 使用自己的 `service.db`、迁移注册表、配置、启动锁和进程生命周期。账号、Session、API Key、邀请码及安全审计沿用现有领域用例；创建账号在同一事务中记录目录初始化事件，不加载模型 ORM 或写 Models 数据库。事件投递和 Models 消费仍需接通后才能开放完整新服务部署。

Gateway 从公共操作归属清单生成精确的方法和路径路由；未知 API 与内部接口返回 404。Gateway 按实际的两个监听器标记本机和公网，先移除外部身份头，再向 Identity 请求短期、绑定目标服务与请求路径的签名上下文。业务服务不能依据 Host 或转发头取得主机权限。

预认证使用 Caddy 的 [forward_auth](https://caddyserver.com/docs/caddyfile/directives/forward_auth)；API 的禁止缓存响应头在上游响应后覆盖，使用官方 [header 延迟写入](https://caddyserver.com/docs/caddyfile/directives/header)能力。Identity 自行校验 Session、账号状态、CSRF 和固定权限。长期连接可通过受限服务凭据重新检查原签名断言，撤销或身份服务不可用时停止授权。

## CLI 构建

```sh
npm run services:contracts:check
npm run services:build -- identity --build
```

当前独立镜像入口仅完成 Identity；其他服务的独立构建会明确拒绝。构建器计算可审计源码闭包并拒绝单体入口、全部 ORM、工坊与模型内部依赖。镜像不复制整个后端，不打包配置、密钥、运行数据或仓库。Identity 自有锁文件固定所需依赖；版本由实际输入内容决定。

`deploy/compose.yaml` 目前装配 Identity 和 Gateway，启动时只使用已构建镜像，不自动构建或迁移。数据库初始化必须通过所属镜像显式执行 `migrate`；已有数据库迁移历史不符时启动失败。`create-admin` 只接受标准输入 JSON，并且仅用于没有账号的新安装；已有正式账号应从受控导入保留。

## Docker 隔离验收

将构建命令输出的镜像传入：

```sh
npm run services:test:docker -- --image fpl/identity:VERSION
```

脚本在被忽略的 `.local/service-split/` 下生成独立数据、测试账号和只读配置，使用随机的 Compose 项目名及 19000／19081 回环端口。它不读取正式配置、密码或数据库。测试结束停止并删除本次容器与网络，保留经过脱敏的日志、报告和恢复快照。

脚本覆盖登录、CSRF、Host／Origin、未知 API、实际监听器权限、重复启动、独立重启、SQLite WAL、完整停机恢复、容器重建与注销。签名转发使用只在测试 Compose 覆盖中存在的协议探针验证；该探针不属于 Agents 实现，不打包进正式镜像，也不能代替工作台或远控业务验收。

所有 Compose 调用显式使用 `--env-file /dev/null`。业务服务仅连接内部网络，没有宿主发布端口；Gateway 另连入口 bridge，仅发布两个 127.0.0.1 端口。每个服务只绑定自己的数据目录及最小只读配置，禁止用户主目录和 Docker Socket。Gateway 的官方 Caddy 二进制带低端口文件能力，当前显式保留该单项容器能力以保证可执行，其余能力均移除。

## 正式切换门禁

仍需完成其余业务服务、独立前端、原生 Mac worker、跨服务回执、正式导出／导入、浏览器回归、完整质量门禁和资源验收。配置真源继续是项目 `backend/config.toml`；当前隔离测试生成的配置不能替换正式配置。

当前网站 `.runtime/` 是唯一正式迁移来源。原桌面目录、旧 Guacamole 数据卷、已验证的本地模型环境及停机快照继续保留。全部隔离验证完成后，才执行已批准的维护窗口与正式数据切换。
