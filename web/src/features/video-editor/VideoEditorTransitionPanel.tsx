import { Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
  VideoEditorTransition,
} from "./types";
import "./video-editor-transitions.css";

type TransitionKind = VideoEditorTimelineTransition["kind"];
type Direction = VideoEditorTimelineTransition["direction"];
type Easing = VideoEditorTimelineTransition["easing"];
type ClipEdge = "in" | "out";

type TransitionDefinition = {
  kind: TransitionKind;
  label: string;
  category: string;
  direction: Direction;
  description: string;
};

const definitions: TransitionDefinition[] = [
  {
    kind: "crossfade",
    label: "交叉叠化",
    category: "叠化",
    direction: "in",
    description: "两个片段平滑衔接",
  },
  {
    kind: "fade-black",
    label: "黑场淡入",
    category: "基础",
    direction: "in",
    description: "通过黑场完成过渡",
  },
  {
    kind: "fade-white",
    label: "白场淡入",
    category: "基础",
    direction: "in",
    description: "明亮闪白后进入画面",
  },
  {
    kind: "wipe-left",
    label: "向左擦除",
    category: "擦除",
    direction: "left",
    description: "从右侧向左揭示",
  },
  {
    kind: "wipe-right",
    label: "向右擦除",
    category: "擦除",
    direction: "right",
    description: "从左侧向右揭示",
  },
  {
    kind: "zoom",
    label: "镜头缩放",
    category: "缩放",
    direction: "in",
    description: "带有镜头推进感",
  },
  {
    kind: "blur",
    label: "径向模糊",
    category: "模糊",
    direction: "in",
    description: "柔和模糊后清晰",
  },
  {
    kind: "flash",
    label: "闪白",
    category: "光效",
    direction: "in",
    description: "短促高亮闪切",
  },
];

const categories = [
  "全部",
  "基础",
  "叠化",
  "擦除",
  "缩放",
  "模糊",
  "光效",
];

const clipById = (clips: VideoEditorClip[], id?: string | null) =>
  clips.find((clip) => clip.id === id);

const defaultDurationUs = 500_000;

export function VideoEditorTransitionPanel({
  clips,
  tracks,
  transitions,
  selectedClip,
  selectedTransitionId,
  target,
  clipEdgeFocus,
  disabled = false,
  commit,
  onSelectTransition,
  onFocusClipEdge,
}: {
  clips: VideoEditorClip[];
  tracks: VideoEditorTrack[];
  transitions: VideoEditorTimelineTransition[];
  selectedClip?: VideoEditorClip;
  selectedTransitionId?: string;
  target?: { fromClipId?: string; toClipId?: string };
  clipEdgeFocus?: ClipEdge;
  disabled?: boolean;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onSelectTransition: (id?: string) => void;
  onFocusClipEdge?: (edge: ClipEdge) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const selectedTransition = transitions.find(
    (item) => item.id === selectedTransitionId,
  );
  const [kind, setKind] = useState<TransitionKind>("crossfade");
  const [kindTouched, setKindTouched] = useState(false);
  const edgeFocus: ClipEdge = clipEdgeFocus ?? "in";
  const activeEdgeTransition: VideoEditorTransition | undefined =
    selectedClip &&
    (edgeFocus === "in" ? selectedClip.transitionIn : selectedClip.transitionOut);

  useEffect(() => {
    setKindTouched(false);
    if (selectedTransition) {
      setKind(selectedTransition.kind);
      return;
    }
    if (
      activeEdgeTransition &&
      activeEdgeTransition.kind !== "audio-crossfade" &&
      activeEdgeTransition.kind !== "cut"
    ) {
      setKind(activeEdgeTransition.kind as TransitionKind);
    }
  }, [
    selectedTransitionId,
    selectedTransition?.kind,
    selectedClip?.id,
    edgeFocus,
    activeEdgeTransition?.kind,
  ]);

  const activeKind: TransitionKind = kindTouched
    ? kind
    : (selectedTransition?.kind ??
      (activeEdgeTransition &&
      activeEdgeTransition.kind !== "audio-crossfade" &&
      activeEdgeTransition.kind !== "cut"
        ? (activeEdgeTransition.kind as TransitionKind)
        : kind));
  const selectedDefinition =
    definitions.find((item) => item.kind === activeKind) ?? definitions[0]!;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return definitions.filter(
      (item) =>
        (!query ||
          `${item.label}${item.category}${item.description}`
            .toLowerCase()
            .includes(query)) &&
        (category === "全部" || item.category === category),
    );
  }, [category, search]);

  const currentFromClip = clipById(
    clips,
    selectedTransition?.fromClipId ?? target?.fromClipId,
  );
  const currentToClip = clipById(
    clips,
    selectedTransition?.toClipId ?? target?.toClipId,
  );
  const canApplyBetween = Boolean(
    currentFromClip &&
    currentToClip &&
    tracks.find((track) => track.id === currentFromClip.trackId)?.kind !==
      "audio" &&
    currentFromClip.timelineStartUs + currentFromClip.durationUs ===
      currentToClip.timelineStartUs,
  );

  const pickKind = (next: TransitionKind) => {
    setKind(next);
    setKindTouched(true);
    const definition = definitions.find((item) => item.kind === next);
    if (selectedTransition && definition) {
      void commit(
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: { kind: next, direction: definition.direction },
          },
        ],
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedTransition.kind,
              direction: selectedTransition.direction,
            },
          },
        ],
      );
      return;
    }
    if (selectedClip && definition && activeEdgeTransition) {
      const previous = activeEdgeTransition;
      const nextEdge: VideoEditorTransition = {
        ...previous,
        kind: next,
        direction: definition.direction,
      };
      void commit(
        [
          {
            type: "setTransition",
            clipId: selectedClip.id,
            edge: edgeFocus,
            transition: nextEdge,
          },
        ],
        [
          {
            type: "setTransition",
            clipId: selectedClip.id,
            edge: edgeFocus,
            transition: previous,
          },
        ],
      );
    }
  };

  const applyBetween = () => {
    if (disabled || !canApplyBetween || !currentFromClip || !currentToClip)
      return;
    if (selectedTransition) {
      void commit(
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedDefinition.kind,
              direction: selectedDefinition.direction,
            },
          },
        ],
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedTransition.kind,
              direction: selectedTransition.direction,
            },
          },
        ],
      );
      return;
    }
    const next: VideoEditorTimelineTransition = {
      id: crypto.randomUUID(),
      kind: selectedDefinition.kind,
      durationUs: defaultDurationUs,
      placement: "between",
      fromClipId: currentFromClip.id,
      toClipId: currentToClip.id,
      direction: selectedDefinition.direction,
      easing: "ease-in-out",
    };
    void commit(
      [{ type: "addTransition", transition: next }],
      [{ type: "removeTransition", transitionId: next.id }],
    ).then(() => onSelectTransition(next.id));
  };

  const applyClipEdge = (edge: ClipEdge) => {
    if (disabled || !selectedClip) return;
    onFocusClipEdge?.(edge);
    const previous =
      edge === "in" ? selectedClip.transitionIn : selectedClip.transitionOut;
    const next: VideoEditorTransition = {
      kind:
        selectedClip.kind === "audio"
          ? "audio-crossfade"
          : selectedDefinition.kind,
      durationUs: previous?.durationUs ?? defaultDurationUs,
      direction: selectedDefinition.direction,
      easing: previous?.easing ?? "ease-in-out",
    };
    void commit(
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge,
          transition: next,
        },
      ],
      previous
        ? [
            {
              type: "setTransition",
              clipId: selectedClip.id,
              edge,
              transition: previous,
            },
          ]
        : [{ type: "setTransition", clipId: selectedClip.id, edge }],
    );
  };

  const updateSeam = (patch: Partial<VideoEditorTimelineTransition>) => {
    if (!selectedTransition || disabled) return;
    const previous = Object.fromEntries(
      Object.keys(patch).map((key) => [
        key,
        selectedTransition[key as keyof VideoEditorTimelineTransition],
      ]),
    );
    void commit(
      [
        {
          type: "updateTransition",
          transitionId: selectedTransition.id,
          patch,
        },
      ],
      [
        {
          type: "updateTransition",
          transitionId: selectedTransition.id,
          patch: previous,
        },
      ],
    );
  };

  const updateClipEdge = (patch: Partial<VideoEditorTransition>) => {
    if (!selectedClip || !activeEdgeTransition || disabled) return;
    const previous = activeEdgeTransition;
    void commit(
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: { ...previous, ...patch },
        },
      ],
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: previous,
        },
      ],
    );
  };

  const removeSeam = () => {
    if (!selectedTransition || disabled) return;
    void commit(
      [{ type: "removeTransition", transitionId: selectedTransition.id }],
      [{ type: "addTransition", transition: selectedTransition }],
    ).then(() => onSelectTransition(undefined));
  };

  const removeClipEdge = () => {
    if (!selectedClip || !activeEdgeTransition || disabled) return;
    void commit(
      [{ type: "setTransition", clipId: selectedClip.id, edge: edgeFocus }],
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: activeEdgeTransition,
        },
      ],
    );
  };

  const editingSeam = Boolean(selectedTransition || canApplyBetween);
  const editingParams = selectedTransition
    ? {
        durationUs: selectedTransition.durationUs,
        direction: selectedTransition.direction,
        easing: selectedTransition.easing,
        update: updateSeam,
        remove: removeSeam,
      }
    : activeEdgeTransition
      ? {
          durationUs: activeEdgeTransition.durationUs,
          direction: activeEdgeTransition.direction,
          easing: activeEdgeTransition.easing,
          update: updateClipEdge,
          remove: removeClipEdge,
        }
      : undefined;

  return (
    <aside className="ve-transition-panel">
      <header className="ve-transition-header">
        <div>
          <strong>转场</strong>
          <small>接缝与片段转场互不干扰，可同时存在</small>
        </div>
        <SlidersHorizontal aria-hidden />
      </header>
      <label className="ve-transition-search">
        <Search aria-hidden />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索转场"
        />
      </label>
      <div className="ve-transition-categories" role="tablist">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="ve-transition-library">
        {filtered.map((item) => (
          <button
            key={item.kind}
            type="button"
            className={`ve-transition-library-card${selectedDefinition.kind === item.kind ? " active" : ""}`}
            onClick={() => pickKind(item.kind)}
          >
            <span
              className={`ve-transition-thumb effect-${item.kind}`}
              aria-hidden
            />
            <span className="ve-transition-card-name">{item.label}</span>
          </button>
        ))}
      </div>

      <section className="ve-transition-editor">
        <div className="ve-transition-editor-title">
          <div>
            <strong>{selectedDefinition.label}</strong>
            <small>{selectedDefinition.description}</small>
          </div>
          {editingParams ? (
            <button
              type="button"
              aria-label="删除当前转场"
              onClick={editingParams.remove}
            >
              <Trash2 aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="ve-transition-field">
          <span>作用对象</span>
          <div className="ve-transition-options wide">
            <button
              type="button"
              className={editingSeam && selectedTransition ? "active" : ""}
              disabled={disabled || (!selectedTransition && !canApplyBetween)}
              onClick={applyBetween}
            >
              {selectedTransition ? "接缝转场" : "应用到接缝"}
            </button>
            <button
              type="button"
              className={
                selectedClip && edgeFocus === "in" && !selectedTransition
                  ? "active"
                  : ""
              }
              disabled={disabled || !selectedClip}
              onClick={() => applyClipEdge("in")}
            >
              设置入场
            </button>
            <button
              type="button"
              className={
                selectedClip && edgeFocus === "out" && !selectedTransition
                  ? "active"
                  : ""
              }
              disabled={disabled || !selectedClip}
              onClick={() => applyClipEdge("out")}
            >
              设置出场
            </button>
          </div>
        </div>

        {selectedClip ? (
          <p className="ve-transition-help">
            片段「{selectedClip.name}」：入场{" "}
            {selectedClip.transitionIn
              ? `${(selectedClip.transitionIn.durationUs / 1_000_000).toFixed(2)}s`
              : "无"}
            ，出场{" "}
            {selectedClip.transitionOut
              ? `${(selectedClip.transitionOut.durationUs / 1_000_000).toFixed(2)}s`
              : "无"}
          </p>
        ) : null}
        {selectedTransition ? (
          <p className="ve-transition-help">
            当前接缝：
            {clipById(clips, selectedTransition.fromClipId)?.name ?? "?"} →{" "}
            {clipById(clips, selectedTransition.toClipId)?.name ?? "?"}
          </p>
        ) : canApplyBetween ? (
          <p className="ve-transition-help">
            当前目标：
            {currentFromClip?.name} → {currentToClip?.name}
          </p>
        ) : !selectedClip ? (
          <p className="ve-transition-help">
            先选择时间线上的接缝或片段
          </p>
        ) : null}

        <label className="ve-transition-field">
          <span>
            时长 <small>秒</small>
          </span>
          <input
            disabled={!editingParams || disabled}
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            value={
              editingParams
                ? (editingParams.durationUs / 1_000_000).toFixed(2)
                : "0.50"
            }
            onChange={(event) =>
              editingParams?.update({
                durationUs: Math.round(
                  Number(event.target.value || 0.5) * 1_000_000,
                ),
              })
            }
          />
        </label>
        <div className="ve-transition-field">
          <span>方向</span>
          <div className="ve-transition-options">
            {(["left", "right", "up", "down"] as const).map((item) => (
              <button
                key={item}
                type="button"
                disabled={!editingParams || disabled}
                className={editingParams?.direction === item ? "active" : ""}
                onClick={() => editingParams?.update({ direction: item })}
              >
                {item === "left"
                  ? "左"
                  : item === "right"
                    ? "右"
                    : item === "up"
                      ? "上"
                      : "下"}
              </button>
            ))}
          </div>
        </div>
        <div className="ve-transition-field">
          <span>缓动效果</span>
          <div className="ve-transition-options wide">
            {(["linear", "ease-in", "ease-out", "ease-in-out"] as const).map(
              (item: Easing) => (
                <button
                  key={item}
                  type="button"
                  disabled={!editingParams || disabled}
                  className={editingParams?.easing === item ? "active" : ""}
                  onClick={() => editingParams?.update({ easing: item })}
                >
                  {item === "linear"
                    ? "匀速"
                    : item === "ease-in"
                      ? "渐入"
                      : item === "ease-out"
                        ? "渐出"
                        : "平滑"}
                </button>
              ),
            )}
          </div>
        </div>
      </section>
    </aside>
  );
}
