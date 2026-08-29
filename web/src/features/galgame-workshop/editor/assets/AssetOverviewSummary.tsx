import { AlertTriangle, ChevronDown, Layers3 } from "lucide-react";
import {
  KIND_META,
  MODULES,
  bytes,
} from "@features/galgame-workshop/editor/assetOverviewModel";
import { useAssetOverviewController } from "@features/galgame-workshop/editor/assets/useAssetOverviewController";

export function AssetOverviewSummary({
  controller,
}: {
  controller: ReturnType<typeof useAssetOverviewController>;
}) {
  const {
    summaryOpen,
    summaryRef,
    items,
    totalBytes,
    statusCounts,
    packageBytes,
    reduction,
    savedBytes,
    skippedCount,
    manifest,
    setSelection,
    typeStats,
    setKind,
    largest,
    topBytes,
    overview,
  } = controller;
  return (
    <>
      {summaryOpen ? (
        <section
          ref={summaryRef}
          className="galgame-assets-summary"
          aria-label="资源统计"
        >
          <article className="galgame-assets-overview-card">
            <small>总览</small>
            <div className="galgame-assets-overview-values">
              <span>
                <small>总素材</small>
                <strong>{items.length}</strong>
                <em>{bytes(totalBytes)}</em>
              </span>
              <span>
                <small>引用 / 游离</small>
                <strong>
                  {statusCounts.referenced} / {statusCounts.orphaned}
                </strong>
              </span>
            </div>
            <div className="galgame-assets-package-card">
              <small>打包预测</small>
              <div>
                <del>{bytes(totalBytes)}</del>
                <span>→</span>
                <strong>{bytes(packageBytes)}</strong>
                <em>减少 {reduction}%</em>
              </div>
              <progress max={Math.max(totalBytes, 1)} value={packageBytes} />
              <footer>
                <span>
                  <i /> 打包 {bytes(packageBytes)}
                </span>
                <span>
                  跳过 {bytes(savedBytes)} · {skippedCount} 项
                </span>
              </footer>
            </div>
            {(manifest.data?.issues?.length ?? 0) > 0 ? (
              <div className="galgame-assets-issues">
                <strong>
                  <AlertTriangle aria-hidden /> {manifest.data?.issues?.length}{" "}
                  个打包阻断项
                </strong>
                {manifest.data?.issues?.slice(0, 3).map((issue, index) => (
                  <button
                    key={`${issue.code}-${index}`}
                    type="button"
                    onClick={() => {
                      if (issue.assetId)
                        setSelection({ kind: "asset", id: issue.assetId });
                      else if (issue.storyAssetId)
                        setSelection({
                          kind: "missing",
                          id: issue.storyAssetId,
                        });
                    }}
                  >
                    {issue.message}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
          <article className="galgame-assets-type-card">
            <small>类型分布</small>
            {typeStats.map((entry) => {
              const meta = KIND_META[entry.kind];
              const Icon = meta.icon;
              const percent = totalBytes
                ? Math.round((entry.bytes / totalBytes) * 100)
                : 0;
              return (
                <button
                  key={entry.kind}
                  type="button"
                  onClick={() => setKind(entry.kind)}
                >
                  <Icon className={meta.className} aria-hidden />
                  <span>
                    <strong>
                      {meta.label} {entry.count}
                    </strong>
                    <progress max="100" value={percent} />
                  </span>
                  <em>{percent}%</em>
                  <small>{bytes(entry.bytes)}</small>
                </button>
              );
            })}
          </article>
          <article className="galgame-assets-largest-card">
            <small>TOP 大户</small>
            <details>
              <summary>
                <Layers3 aria-hidden />
                <strong>
                  Top {largest.length} 占{" "}
                  {totalBytes
                    ? ((topBytes / totalBytes) * 100).toFixed(1)
                    : "0.0"}
                  %
                </strong>
                <ChevronDown aria-hidden />
              </summary>
              <div>
                {largest.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelection({ kind: "asset", id: item.id })}
                  >
                    <span>{item.display_name}</span>
                    <em>{bytes(item.byte_size)}</em>
                  </button>
                ))}
              </div>
            </details>
          </article>
          <article className="galgame-assets-module-card">
            <small>类型健康度</small>
            <div>
              {MODULES.map((module) => {
                const matching = items.filter((item) =>
                  module.categories.includes(item.category ?? "other"),
                );
                const moduleBytes = matching.reduce(
                  (sum, item) => sum + item.byte_size,
                  0,
                );
                const orphans = matching.filter((item) => item.orphaned).length;
                const missing = module.categories.some(
                  (category) =>
                    overview.data?.moduleHealth?.[category] === "error",
                );
                const Icon = module.icon;
                return (
                  <button
                    key={module.label}
                    type="button"
                    className={missing || orphans ? "warning" : ""}
                    onClick={() => {
                      const target = module.categories[0];
                      if (target === "font") setKind("font");
                      else if (
                        ["bgm", "ambient", "sfx", "voice"].includes(target)
                      )
                        setKind("audio");
                      else if (target === "video") setKind("video");
                      else setKind("image");
                    }}
                  >
                    <Icon aria-hidden />
                    <strong>{module.label}</strong>
                    <em>{matching.length}</em>
                    <small>{bytes(moduleBytes)}</small>
                    <progress
                      max={Math.max(totalBytes, 1)}
                      value={moduleBytes}
                    />
                  </button>
                );
              })}
            </div>
          </article>
        </section>
      ) : null}
    </>
  );
}
