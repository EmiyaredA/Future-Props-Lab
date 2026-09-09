import { useState } from "react";
import { ReadOnlyMedia } from "./ReadOnlyMedia";
export function ReadOnlyAssetList({
  items,
}: {
  items: readonly { id: string; name: string; kind: string; path: string }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const asset = items.find((item) => item.id === selected);
  return (
    <section>
      <h2>已有素材</h2>
      <div className="readonly-collection">
        {items.map((item) => (
          <button
            className="readonly-card"
            key={item.id}
            onClick={() => setSelected(item.id)}
          >
            <strong>{item.name}</strong>
            <small>预览与下载</small>
          </button>
        ))}
      </div>
      {asset ? (
        <article>
          <h3>{asset.name}</h3>
          <ReadOnlyMedia
            path={asset.path}
            kind={asset.kind}
            name={asset.name}
          />
        </article>
      ) : null}
    </section>
  );
}
