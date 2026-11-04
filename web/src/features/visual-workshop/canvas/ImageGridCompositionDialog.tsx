import { LoadingScene } from "@shared/ui/LoadingScene";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import type {
  ImageCompositionInput,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import { useImagePreviewUrl } from "@platform/api/useImagePreviewUrl";

type ImageNode = Extract<VisualCanvasNode, { kind: "image" }>;
type CompositionItem = { node: ImageNode; caption: string };

function PreviewCell({ item }: { item: CompositionItem }) {
  const { ref, url } = useImagePreviewUrl(
    `/v1/files/${item.node.asset_id}/content`,
  );
  return (
    <div ref={ref} className="image-grid-preview-cell">
      {url ? (
        <ResponsiveImage src={url} alt={item.caption || item.node.title} />
      ) : (
        <LoadingState label="加载中…" variant="inline" />
      )}
      {item.caption ? <small>{item.caption}</small> : null}
    </div>
  );
}

export function ImageGridCompositionDialog({
  nodes,
  initialNodeIds,
  canvasRevision,
  resultPosition,
  onClose,
  onSubmit,
}: {
  nodes: ImageNode[];
  initialNodeIds: string[];
  canvasRevision: number;
  resultPosition: { x: number; y: number };
  onClose: () => void;
  onSubmit: (body: ImageCompositionInput) => Promise<void>;
}) {
  const initialSize = initialNodeIds.length === 9 ? 9 : 4;
  const [gridSize, setGridSize] = useState<4 | 9>(initialSize);
  const [items, setItems] = useState<CompositionItem[]>(() =>
    initialNodeIds
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is ImageNode => Boolean(node?.asset_id))
      .map((node) => ({ node, caption: node.title })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState<number>();
  const available = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.asset_id && !items.some((item) => item.node.id === node.id),
      ),
    [items, nodes],
  );
  const canSubmit =
    items.length === gridSize && items.every((item) => item.node.asset_id);

  const changeGridSize = (next: 4 | 9) => {
    setGridSize(next);
    if (items.length > next) setItems((current) => current.slice(0, next));
  };
  const toggleNode = (node: ImageNode) => {
    setItems((current) =>
      current.some((item) => item.node.id === node.id)
        ? current.filter((item) => item.node.id !== node.id)
        : current.length < gridSize
          ? [...current, { node, caption: node.title }]
          : current,
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };
  const dropAt = (index: number) => {
    if (dragIndex === undefined || dragIndex === index) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(undefined);
  };
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        grid_size: gridSize,
        items: items.map((item) => ({
          node_id: item.node.id,
          asset_id: item.node.asset_id!,
          caption: item.caption,
        })),
        expected_canvas_revision: canvasRevision,
        result_position: resultPosition,
        title: `${gridSize}宫格合成`,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "合成任务提交失败");
      setBusy(false);
    }
  };

  return (
    <div className="image-grid-dialog-backdrop" role="presentation">
      <section
        className="image-grid-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="合成宫格"
      >
        <header>
          <div>
            <strong>合成宫格</strong>
            <span>选择图片、调整顺序并添加 caption</span>
          </div>
          <button aria-label="关闭合成面板" onClick={onClose} disabled={busy}>
            <X aria-hidden />
          </button>
        </header>
        <div className="image-grid-dialog-body">
          <div
            className="image-grid-dialog-options"
            role="group"
            aria-label="宫格规格"
          >
            {[4, 9].map((value) => (
              <button
                type="button"
                className={gridSize === value ? "active" : ""}
                key={value}
                onClick={() => changeGridSize(value as 4 | 9)}
              >
                {value} 宫格
              </button>
            ))}
            <span>
              {items.length}/{gridSize} 张
            </span>
          </div>
          <div className="image-grid-dialog-columns">
            <div className="image-grid-dialog-selection">
              <strong>画布图片</strong>
              {nodes.length === 0 ? <span>没有可用的图片节点</span> : null}
              {nodes.map((node) => {
                const selected = items.some((item) => item.node.id === node.id);
                return (
                  <label
                    className={!node.asset_id ? "disabled" : ""}
                    key={node.id}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        !node.asset_id ||
                        (!selected && items.length >= gridSize)
                      }
                      onChange={() => toggleNode(node)}
                    />
                    <span>{node.title}</span>
                    {!node.asset_id ? <em>等待素材</em> : null}
                  </label>
                );
              })}
            </div>
            <div className="image-grid-dialog-order">
              <strong>合成顺序与 caption</strong>
              {items.map((item, index) => (
                <div
                  className="image-grid-order-row"
                  draggable
                  key={item.node.id}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropAt(index)}
                >
                  <GripVertical aria-hidden />
                  <span className="image-grid-order-index">{index + 1}</span>
                  <input
                    aria-label={`${item.node.title} caption`}
                    maxLength={120}
                    value={item.caption}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.node.id === item.node.id
                            ? { ...entry, caption: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder="caption（可留空）"
                  />
                  <button
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </button>
                  <button
                    aria-label="下移"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </button>
                </div>
              ))}
              {available.length === 0 && items.length < gridSize ? (
                <span>没有更多可用图片</span>
              ) : null}
            </div>
          </div>
          <div
            className={`image-grid-live-preview grid-${gridSize}`}
            aria-label="合成预览"
          >
            {items.map((item) => (
              <PreviewCell item={item} key={item.node.id} />
            ))}
          </div>
          {error ? (
            <p className="image-grid-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer>
          <span>
            {canSubmit
              ? "原节点会保留，合成结果会新增为一个图片节点"
              : `还需要选择 ${gridSize - items.length} 张图片`}
          </span>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
          >
            {busy ? <LoadingScene /> : null}
            生成合成图
          </button>
        </footer>
      </section>
    </div>
  );
}
