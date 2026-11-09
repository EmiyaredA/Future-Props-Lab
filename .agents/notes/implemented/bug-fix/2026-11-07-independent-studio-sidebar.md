# Agent Note: 独立入口恢复 Studio 导航

Status: implemented

## Problem

独立服务的顶层页面使用单独的顶部导航，导致文件管理和门户等页面失去原有的 Studio 侧边栏与页面间一致的导航。

## Decision

独立入口的 Studio 顶层路由复用 StudioShell 和路由映射，跨文档跳转继续经过现有未保存导航保护。工坊路由保留原有独立壳；助手入口仅在当前装配提供回调时显示。

## Alternatives considered

继续扩充独立顶部导航会复制权限和导航逻辑，也无法恢复原有侧边栏体验。

## Consequences

顶层独立入口共享 Studio 导航和账号菜单；页面所属服务及访问权限不变。

## Verification

使用 TypeScript、ESLint 和独立入口测试验证装配；应在独立服务浏览器环境检查响应式导航。
