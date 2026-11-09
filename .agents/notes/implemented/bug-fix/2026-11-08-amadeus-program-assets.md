# Agent Note: Amadeus 头像资源随应用构建发布

Status: implemented

## Problem

独立 Studio 应用的 Amadeus 面板请求根路径下的头像和 Live2D 模型。独立构建的资源清单缺少这三个文件，本机和公网都返回 404。

## Decision

提供 Amadeus 面板的应用将普通头像、舞台备用图和 Live2D 包纳入各自的程序资源清单。面板通过 `programAsset` 解析地址，独立应用使用本次构建的资源前缀，兼容网站使用原有的根路径。

## Alternatives considered

网关可以转发旧路径到 Portal，但会让每个独立应用的头像依赖 Portal 的构建和可用性。

## Consequences

提供面板的应用各自发布同一组资源。应用重新构建时，头像文件参与构建 ID 计算。

## Verification

在独立前端产物中核对三个资源的内容和版本路径，并检查 Amadeus 面板能解码备用头像。
