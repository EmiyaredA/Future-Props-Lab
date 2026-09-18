# Agent Note: 视频预览音频断续

Status: implemented

## Problem

节目监视器播放时，预览音频听起来断断续续：墙钟 rAF 推进的 playhead 与 `<audio>` 自身时钟在视频解码卡顿下会漂移，旧逻辑以 0.12s 容差反复 `currentTime` seek，每次 seek 清空解码缓冲，听感像卡顿。

## Decision

预览仍用 HTMLMediaElement，但音频同步改为：播放中容差放宽到 0.45s、元素仍在 `seeking` 时不再叠加重 seek、仅在开始播放或 scrub（暂停）时强制对齐；音量包络仍按 playhead 更新。画面轨保持更紧的 0.12s 容差。

## Alternatives considered

- **用 Web Audio API / AudioBuffer 重建预览混音** — 更平滑，但改动面大，且长素材内存与解码路径要另做。
- **让音频时钟驱动 playhead** — 多轨与无音区间要另定主时钟，超出本次修卡顿范围。
- **继续 0.12s 紧同步** — 画面可接受，音频 seek 代价过高。

## Consequences

- **收益**：重负载下预览音频连续播放，不再因小幅漂移反复 seek。
- **代价与上限**：播放中音画可能短暂偏到约 0.45s；用户 scrub 或重新按下播放会重新对齐。导出成片路径不变。

## Verification

`npm run test --workspace web -- tests/video-editor-preview-playback.test.tsx`
