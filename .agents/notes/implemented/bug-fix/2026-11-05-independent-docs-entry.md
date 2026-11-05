# Agent Note: 独立门户文档中心别名

Status: implemented

## Problem

网关把登记的 `/docs` 交给门户。原独立门户只有 `/docs.html` 页面和 `/docs/{path}` 文档资源，裸地址被路由框架送到资源路径，无法打开文档中心。

## Decision

独立门户对 `/docs` 与 `/docs/` 的 GET 和 HEAD 显式返回相对地址 `/docs.html`。重定向禁止缓存，并在通用资源路由前注册。

## Alternatives considered

直接返回门户程序需要让前端在三个地址都识别文档中心，增加路径分支。

## Consequences

本机和公网入口共用同一文档地址，已有资源路径继续按发布清单处理。

## Verification

真实门户装配加载独立发布清单，验证两个别名的响应、最终页面的发布版本头和未知资源 404。
