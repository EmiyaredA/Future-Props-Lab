# Agent Note: 完整序列帧缓存命中与冷加载使用一致请求预算

Status: implemented

## Problem

完整序列帧的一次切换需要同时保留实际已绘原帧、目标动作和所选过渡区间涉及的图集。冷加载按这些去重 PNG 的完整解码像素总数限制在 16,777,216；全部纹理已缓存时却直接接受请求，没有检查同一预算。同样两个 3000×3000 图集的 18,000,000 像素工作集，先分别预热后能播放，直接冷切换则被拒绝。资源能否使用取决于此前打开动作的顺序，预算不能可靠约束工作集。

## Decision

`SequenceFigure.load` 在缓存命中快捷返回前，累计本次去重纹理集合中已解码 PNG 的实际尺寸。超过原 16M 请求预算时，沿用冷加载的资源错误『完整动作图集超过解码预算』并保留最后正确画面；冷加载继续对已缓存及新解码纹理累计检查。错误保持到后续成功提交，取消或自动回待机不隐式重试，显式重播及新服饰选择仍使用现有恢复边界。16M 请求及 32M 已持有缓存预算均不改变。

## Alternatives considered

- **只依赖 32M 缓存驱逐** — 可以约束长期已持有缓存，但18M工作集仍处于32M以内，不能修复同一请求在冷暖路径上的不同结果。
- **提高请求预算使冷路径接受缓存结果** — 会使更多大图同时参与切换，没有当前需求或实测内存依据，因此保留已有上限。
- **每次动作切换清空全部缓存** — 能消除预热差异，但增加重复解码和请求，破坏已可用的换装及重播复用，没有必要。

## Consequences

- **收益**：合法资源的请求预算与访问历史无关；共享纹理只计一次，超额时不复活旧分件动画、不丢失当前已绘原帧。
- **代价与边界**：每次 load 对已有去重集合增加一次小规模遍历。该修改不能在 PNG 解码前得知实际尺寸，也不限制浏览器解码暂存、Canvas、兼容 base CPU 图片或多个窗口合计内存。32M 不是进程总内存上限；没有证据将这项缺陷与 Chromium tile 警告建立完整因果关系。
- **兼容**：不更改资源格式、素材、Player、公开 API、持久配置或数据库；保留过渡分支、所选区间和取消代次的已有行为。

## Verification

`web/tests/desktop-pet-sequence-figure.test.ts` 增加6项生产 parser/player/figure 路由回归：warm/cold均拒绝18M并保留原cel，两者均接受恰好16M，共享同纹理只请求和绘制一次，取消不隐式恢复、显式重播/换装成功后清错，旧代次的超额解码不能污染新服饰。受控浏览器尺寸不是原生显存或美术验收。

- `npx vitest run tests/desktop-pet-sequence-figure.test.ts`：32 PASS（原26+新增6）。
- Figure/cache/presentation/support/ranges/branches/cels/scheme failure：8文件241 PASS；恢复与拎起入口补测3文件52 PASS（其中Figure32重复，不重复合计）。
- 原生 Web TypeScript、本次2文件 ESLint/Prettier通过。完整前端lint、build、公共契约与文档保护结果在旁置本地检查报告中记录，由主Agent统一集成。
- 修复原字节、owned.patch、日志及冻结 SHA：`.local/desktop-pet/sequence-request-budget/fix/`。本地证据不作为可再分发素材或正式 App 验收。
