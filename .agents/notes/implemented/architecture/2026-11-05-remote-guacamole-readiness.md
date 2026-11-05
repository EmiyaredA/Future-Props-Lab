# Agent Note: Remote 的 Guacamole 依赖和生产就绪

Status: implemented

## Problem

Remote 需检测容器中实际使用的 Guacamole 传输。主线的桌面画面适配增加了 Pillow 依赖，Remote 的旧偏好迁移回执也需继续保留。

## Decision

为 Remote 单独锁定镜像依赖，保留偏好迁移回执。Guacamole 通过私网伴随进程部署，使用显式选择并预先导入的固定镜像。Remote 就绪要求本机设置 worker、完整配置投影和实际 Guacamole TCP 对端，设置页面报告同一对端的状态。

## Alternatives considered

仅检测 Mac 上的端口无法说明容器正在使用的私网对端是否可用。为全部通用 HTTP 服务加入图片依赖会扩大无关镜像。

## Consequences

Remote 镜像使用独立的依赖锁和公共 HTTP 启动方式。Guacamole 仅在私网接受请求，VNC 目标由部署预设确定。

## Verification

56 项定向测试覆盖旧站快照、Remote 偏好迁移、设置、就绪和架构。隔离六容器运行通过真实 Guacamole 和受密码保护的 RFB 夹具向 Chromium 传输画面，并验证 Mac 设置保存、窄屏页面与服务重启后的读回。
