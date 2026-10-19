import { lazy, Suspense, useEffect, useState } from "react";
import { newId } from "../templates";
import type { Slide } from "../types";
import type { PresentationAction } from "../PresentationMenu";
import {
  appendFragment,
  cloneFragment,
  groupSelection,
  members,
  selectedGroup,
  ungroup,
  withoutGroup,
  type Fragment,
  type Connection,
} from "./model";
import { ReferenceDialog, ReferenceView } from "./SceneDialogs";
import { ConnectionPanel } from "./ConnectionPanel";
import type { PanelPosition } from "./useConnectionPanelPosition";
import {
  newConnection,
  patchConnection,
  validConnection,
} from "./connectionEditing";
import { SceneChecks } from "./SceneChecks";
import { orderScene } from "./stacking";
import "./scene.css";

const InfographicDialog = lazy(
  () => import("../infographics/InfographicDialog"),
);

export function useSceneTools({
  slide,
  selected,
  select,
  change,
  readOnly,
  onComposition,
  restoreVersion,
}: {
  slide: Slide;
  selected: string[];
  select: (ids: string[]) => void;
  change: (update: (s: Slide) => Slide, group?: string) => void;
  readOnly: boolean;
  onComposition?: (active: boolean) => void;
  restoreVersion?: number;
}) {
  const [dialog, setDialog] = useState<"info" | "reference" | null>(null),
    [scopeState, setScopeState] = useState({
      slideId: slide.id,
      id: null as string | null,
    }),
    [edgeId, setEdgeId] = useState<string | null>(null);
  const [pending, setPending] = useState<Connection | null>(null);
  const [connectionSlideId, setConnectionSlideId] = useState<string | null>(
    null,
  );
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const closeConnection = () => {
    setEdgeId(null);
    setPending(null);
    setConnectionSlideId(null);
  };
  const openConnection = (id: string) => {
    if (readOnly) return;
    select([]);
    setPending(null);
    setEdgeId(id);
    setConnectionSlideId(slide.id);
  };
  useEffect(() => {
    if (readOnly || selected.length) {
      setEdgeId(null);
      setPending(null);
      setConnectionSlideId(null);
    }
  }, [readOnly, selected]);
  const [checks, setChecks] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const scope =
    scopeState.slideId === slide.id &&
    slide.groups?.some((g) => g.id === scopeState.id)
      ? scopeState.id
      : null;
  const setScope = (id: string | null) =>
    setScopeState({ slideId: slide.id, id });
  useEffect(() => {
    if (scopeState.id && !scope) setScopeState({ slideId: slide.id, id: null });
  }, [scope, scopeState.id, slide.id]);
  useEffect(() => {
    setDialog(null);
    setEdgeId(null);
    setPending(null);
    setConnectionSlideId(null);
    setChecks(false);
    setError("");
  }, [slide.id]);
  const group = selectedGroup(slide, selected, scope);
  const selectInScope = (id: string | null, ids: string[]) => {
    if (readOnly || (id && !slide.groups?.some((g) => g.id === id))) return;
    setScope(id);
    select(ids);
  };
  const exitGroup = () => {
    if (scope) {
      selectInScope(
        slide.groups?.find((g) => g.id === scope)?.parent_id ?? null,
        members(slide, scope),
      );
    }
  };
  const info = (slide.infographics ?? []).find((i) => i.group_id === group?.id);
  const connectionActive = !readOnly && connectionSlideId === slide.id;
  const edge = connectionActive
    ? (slide.connections ?? []).find((c) => c.id === edgeId)
    : undefined;
  useEffect(() => {
    if (edgeId && !edge) setEdgeId(null);
  }, [edgeId, edge]);
  const preview =
    connectionActive && pending && validConnection(slide, pending)
      ? pending
      : null;
  const connectionValue = edge ?? (connectionActive ? pending : null);
  const updateConnection = (patch: Partial<Connection>, group?: string) => {
    if (!connectionValue || readOnly) return;
    if (pending)
      setPending((current) => current && patchConnection(current, patch));
    else
      change(
        (current) => ({
          ...current,
          connections: (current.connections ?? []).map((c) => {
            if (c.id !== edgeId) return c;
            const next = patchConnection(c, patch);
            return validConnection(current, next) ? next : c;
          }),
        }),
        group ? `connection:${edgeId}:${group}` : undefined,
      );
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const apply = (fragment: Fragment) => {
    if (
      info &&
      members(slide, info.group_id).some(
        (id) => slide.elements.find((e) => e.id === id)?.locked,
      )
    )
      throw new Error("请先解锁信息图成员");
    const base = info ? withoutGroup(slide, info.group_id) : slide;
    const inserted = cloneFragment(
      { ...slide, ...fragment },
      fragment.elements.map((e) => e.id),
      newId,
      0,
    );
    const next = appendFragment(base, inserted);
    change(() => next);
    select(inserted.elements.map((e) => e.id));
  };
  const infoAction: PresentationAction = {
    label: info ? "编辑信息图源码" : "信息图",
    onSelect: () => {
      setError("");
      setDialog("info");
    },
  };
  const lockedSelection = selected.some(
    (id) => slide.elements.find((e) => e.id === id)?.locked,
  );
  const actions: PresentationAction[] = [
    {
      label: "连接节点",
      disabled: slide.elements.filter((e) => e.kind !== "line").length < 2,
      onSelect: () => {
        setPending(newConnection(slide, selected));
        setEdgeId(null);
        setConnectionSlideId(slide.id);
        select([]);
      },
    },
    {
      label: "编组",
      disabled: selected.length < 2 || lockedSelection,
      onSelect: () =>
        change((s) => groupSelection(s, selected, newId(), scope)),
    },
    {
      label: "解组",
      disabled: !group || lockedSelection,
      onSelect: () => {
        if (group) change((s) => ungroup(s, group.id));
      },
    },
    ...(group
      ? [
          {
            label: "进入分组",
            onSelect: () => selectInScope(group.id, []),
          },
        ]
      : []),
    ...(scope
      ? [
          {
            label: "退出分组",
            onSelect: exitGroup,
          },
        ]
      : []),
    {
      label: busy ? "布局中…" : "自动布局",
      disabled: busy || !slide.connections?.length,
      onSelect: () =>
        void run(async () => {
          const { layoutScene } = await import("../infographics/layout");
          const next = await layoutScene(slide, group?.id);
          change(() => next);
        }),
    },
    { label: "参考图", onSelect: () => setDialog("reference") },
    {
      label: checks ? "关闭页面检查" : "检查页面",
      onSelect: () => setChecks((v) => !v),
    },
  ];
  return {
    scope,
    selectInScope,
    exitGroup,
    scopeIndicator:
      scope && !readOnly ? (
        <div
          className="presentation-group-scope"
          role="group"
          aria-label="组内编辑"
        >
          <span aria-live="polite">
            组内编辑：{slide.groups?.find((g) => g.id === scope)?.name}
          </span>
          <button
            type="button"
            onClick={(event) => {
              const canvas = event.currentTarget
                .closest(".presentation-center")
                ?.querySelector<HTMLElement>(".presentation-canvas");
              exitGroup();
              canvas?.focus();
            }}
          >
            退出分组
          </button>
        </div>
      ) : null,
    edgeId: connectionValue?.id ?? null,
    closeConnection,
    connectionOpen: !!connectionValue,
    previewConnection: preview,
    connectionPanel: connectionValue ? (
      <ConnectionPanel
        key={connectionValue.id}
        slide={slide}
        value={connectionValue}
        creating={!!pending}
        position={position}
        onMove={setPosition}
        onComposition={onComposition}
        restoreVersion={restoreVersion}
        onChange={updateConnection}
        onOrder={(mode) => {
          if (!edge || readOnly) return;
          change((current) => orderScene(current, [edge.id], mode));
        }}
        onClose={closeConnection}
        onCreate={() => {
          if (!pending || !validConnection(slide, pending) || readOnly) return;
          change((current) =>
            validConnection(current, pending)
              ? {
                  ...current,
                  connections: [...(current.connections ?? []), pending],
                }
              : current,
          );
          setEdgeId(pending.id);
          setPending(null);
        }}
        onRemove={() => {
          if (readOnly) return;
          change((current) => ({
            ...current,
            connections: (current.connections ?? []).filter(
              (c) => c.id !== edgeId,
            ),
          }));
          closeConnection();
        }}
      />
    ) : null,
    infoAction: readOnly ? undefined : infoAction,
    actions: readOnly ? [] : actions,
    onSelectEdge: openConnection,
    referenceSide: <ReferenceView slide={slide} />,
    referenceOverlay: <ReferenceView slide={slide} overlay />,
    checks: (
      <>
        {error && (
          <p className="presentation-error" role="alert">
            {error}
          </p>
        )}
        {checks && (
          <SceneChecks
            slide={slide}
            select={(ids) => {
              if (slide.connections?.some((c) => c.id === ids[0])) {
                openConnection(ids[0]);
              } else select(ids);
            }}
            onClose={() => setChecks(false)}
          />
        )}
      </>
    ),
    dialogs: !readOnly && (
      <>
        {dialog === "info" && (
          <Suspense fallback={<p role="status">加载信息图模块…</p>}>
            <InfographicDialog
              info={info}
              onClose={() => setDialog(null)}
              onApply={apply}
            />
          </Suspense>
        )}
        {dialog === "reference" && (
          <ReferenceDialog
            slide={slide}
            onClose={() => setDialog(null)}
            onChange={(reference) => change((s) => ({ ...s, reference }))}
          />
        )}
      </>
    ),
  };
}

export function copySelection(slide: Slide, selected: string[]): Fragment {
  return cloneFragment(slide, selected, newId);
}
