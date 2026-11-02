# Agent Note: 固定图标中的响应式图片完整显示

Status: implemented

## Problem

应用卡片与最近访问的角色图只显示局部。实际浏览器测量显示，46px 图标框中的图片被计算为 44×150px；共享图片组件为懒加载图片自动插入 sizes=auto，触发浏览器尺寸隔离及默认固有占位，与网格中的百分比高度产生循环尺寸依赖。

## Decision

ResponsiveImage 保留原生懒加载和预生成 WebP srcset，不再自动插入 auto sizes。有明确宽度时使用该宽度，没有宽度时使用 viewport fallback，调用方显式 sizes 仍优先，鉴权 URL 与非 srcset 图片不变。应用与最近访问提供明确的固有宽高，图标网格限制在已有容器内并用 contain 显示完整原图；公共工坊标识也提供明确尺寸。

## Alternatives considered

- 只改 object-fit：只能改变被过高图片框内部的绘制，不能修复网格行的 150px 计算结果。
- 关闭懒加载或取消 srcset：会丢失原有加载收益，因此保留两者并修正尺寸声明。

## Consequences

中央修复覆盖所有使用生成公共图片变体的入口，不更改私人头像的裁切意图、业务图片预览接口或文件内容。未知显示宽度的公共图片采用保守的 viewport fallback，已知尺寸图标继续选择小尺寸变体，调用方可用 sizes 精细配置响应式场景。

## Verification

浏览器以 2 倍像素密度验证 10 个应用图标与最近访问，覆盖 1440、1280、390 宽度和深浅主题，并验证侧栏、账号菜单及多个工坊标识的图片完整落在容器内。图片组件回归同时检查原生 lazy、WebP srcset、显式 sizes 和无隐式 auto 的默认行为。截图与结果位于 `.local/home-redesign/image-results/`。
