# Agent Note: 在启动前核对 Creative 网关凭据

Status: implemented

## Problem

网站入口令牌与 Gateway 的 Identity 服务凭据用途不同。隔离部署将两者配成同一个值时，
服务启动和只读探针均通过，真实 Creative 安装在原始请求体签名阶段被拒绝。

## Decision

选定 Creative 时，管理启动器核对 Gateway 的服务凭据与 Identity 的登记值一致，并核对
它独立于网站入口、管理入口和其他服务的凭据。检查失败在访问业务数据库及启动 Compose 前
返回，报错只给出配置项或用途。

## Alternatives considered

放宽 Identity 的签名检查会扩大入口令牌的权限。只在首次安装时返回更详细的报错会让
错误部署继续接收用户流量。

## Consequences

正确配置的路由、签名和回执语义保持原契约。更换或重发凭据应同步检查 Gateway 文件、
Identity 登记和入口配置。

## Verification

- 定向回归 70 项通过，覆盖凭据复用、登记值不一致、私有 Unix socket、安装授权及契约。
- 相同隔离镜像复现入口凭据复用时的 403。改用独立凭据后，真实 Compose 经浏览器发布
  并完成 Creative 安装。
