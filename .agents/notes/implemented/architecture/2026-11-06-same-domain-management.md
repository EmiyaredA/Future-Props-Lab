# Agent Note: 同域名管理中台

Status: implemented

## Problem

公网业务和管理中台共用已部署的 HTTPS 域名。两套浏览器会话原先都调用根路径下的 `/v1/auth`，代理无法用路径区分两者的登录请求。

## Decision

公网代理通过路径将管理页面和静态资源送到独立管理隧道。管理浏览器请求使用 `/management/v1`，管理网关在按操作清单匹配前去掉 `/management`。管理公网会话和 CSRF Cookie 使用 `/management` 路径，管理网关的凭据与实际监听器继续决定会话用途和本机权限。管理隧道从 `/management/build.json` 比对本机与公网版本。

## Alternatives considered

独立子域可利用浏览器的来源隔离，需要为管理中台另配置域名。共用根 API 再按浏览器提交的标识分流会让入口选择依赖客户端数据。

## Consequences

现有 HTTPS 域名和业务 API 路径继续提供服务。两个应用共享浏览器来源，Cookie 路径限制自动发送范围。公网管理入口由单独的回环端口和受限 SSH 凭据连接，主机动作继续受本机身份检查约束。

## Verification

管理浏览器测试仅拦截带前缀的请求。隔离网关验收核对管理登录、Cookie 属性、注销、未知路由、构建探针和公网主机动作拒绝。
