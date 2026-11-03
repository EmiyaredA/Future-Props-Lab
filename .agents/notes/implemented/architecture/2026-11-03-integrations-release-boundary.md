# Agent Note: Integrations 独立程序与部署边界

Status: implemented

## Problem

Integrations 的独立业务装配没有对应源码闭包、镜像锁、浏览器构建和部署叠加清单，无法证明容器只取得自己需要的代码与数据。主机环境中的镜像变量也不应隐式启用新服务。

## Decision

构建器只跟随 `fpl_integrations.__main__` 的静态项目依赖，拒绝单体数据库、其他应用 ORM、模型实现与 Mac 执行器；`IncomingFile` 作为既有值协议允许使用。每个镜像有独立依赖锁和不可变版本，浏览器程序单独构建并验证本服务契约。

Integrations Compose 叠加清单只挂载自有状态和最小只读配置，公开 API 经固定网关；供应商外联使用独立 egress 网络。Mac MCP 使用仅回环的原生入口，拒绝浏览器 Origin，先清除外部身份头，再注入服务专有入口证明。部署协调器只读取显式 TOML 投影中的 `FPL_INTEGRATIONS_IMAGE` 选择叠加清单，缺失或链接清单拒绝启动。

## Alternatives considered

- 复制完整后端与主机目录：无法审计服务归属并暴露无关权限。
- 从 Shell 环境自动选择服务：绕过持久配置审核，也可能启用未验证镜像。
- 将原生入口开放在浏览器端口：混合 Session 与原生 worker 的信任边界。

Models 与 Integrations 新增的独立回执使用各自 Declarative registry，不注册到恢复网站的全局 Base。既有复用业务模型仍由显式自有模型清单过滤，独立服务根记录须具备账号归属。

## Consequences

Integrations 可以独立打包，部署选择不改变正式配置。该边界不代表其余应用、真实外部供应商和正式数据迁移已经完成；仍须通过所有对应验收后才能切换。

## Verification

部署与源码闭包回归检查隐藏跨服务导入、所属卷、无宿主发布端口、显式选择和符号链接拒绝。原生网关检查覆盖精确 Host、浏览器拒绝及身份头清理；业务协议和容器验收单独执行。

实际九服务验收 `fpl-isolated-agents-e308095503` 的 17 项综合检查通过；原生 stdio、共享额度、Skills 持久化与独立重启通过，四个页面覆盖三种宽度与明暗主题。最小镜像固定 PyYAML，并在镜像构建时导入实际应用，验证运行依赖闭包。
