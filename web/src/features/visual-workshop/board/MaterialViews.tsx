import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { Clapperboard, Folder, Search, Pin, X } from "lucide-react";
import { cardsKey, listCards, type CardKind } from "../creative/api";
import { cardKindInfo, cardKinds } from "../creative/cardKinds";
import "./material-views.css";

export type MaterialView = "files" | CardKind;
export type WorkbenchSection = MaterialView | "storyboard";
const materialViewLabels = {
  files: "文件",
  storyboard: "分镜",
  character: "人设",
  scene: "场景",
  prop: "道具",
};

export function MaterialViews({
  view,
  onView,
  ids,
  fileCount,
  search,
  onSearch,
  children,
  footer,
  onStoryboard,
  storyboardCount,
  open = true,
  onOpenChange,
  pinned = false,
  onPinnedChange,
}: {
  view: WorkbenchSection;
  onView: (view: MaterialView) => void;
  onStoryboard?: () => void;
  storyboardCount?: number;
  ids: string[];
  fileCount: number;
  search: string;
  onSearch: (search: string) => void;
  children: ReactNode;
  footer: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: cardsKey,
    queryFn: ({ signal }) => listCards(signal),
    staleTime: 30_000,
  });
  const projectIds = new Set(ids);
  const cards = query.data?.filter((card) => projectIds.has(card.id));
  const close = () => {
    onOpenChange?.(false);
    root.current
      ?.querySelector<HTMLButtonElement>('[role="tab"][data-state="active"]')
      ?.focus();
  };
  useEffect(() => {
    if (!open || pinned || !onOpenChange) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        !root.current?.closest("[hidden], [inert]") &&
        !root.current?.contains(target) &&
        !target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        root.current?.closest("[hidden], [inert]") ||
        event.defaultPrevented ||
        (event.target as HTMLElement).closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      onOpenChange(false);
      root.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][data-state="active"]')
        ?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open, pinned, onOpenChange]);
  return (
    <Tabs.Root
      ref={root}
      className={`board-material-views${open ? " is-open" : ""}${pinned ? " is-pinned" : ""}`}
      orientation="vertical"
      activationMode="manual"
      value={view}
      onValueChange={(value) => {
        onOpenChange?.(true);
        if (value === "storyboard") onStoryboard?.();
        else onView(value as MaterialView);
      }}
    >
      <Tabs.List className="board-material-rail" aria-label="素材分类">
        {(["files", "storyboard", ...cardKinds] as const).map((kind) => {
          const Icon =
            kind === "files"
              ? Folder
              : kind === "storyboard"
                ? Clapperboard
                : cardKindInfo[kind].icon;
          const count =
            kind === "files"
              ? fileCount
              : kind === "storyboard"
                ? storyboardCount
                : cards?.filter((card) => card.kind === kind).length;
          return (
            <Tabs.Trigger
              key={kind}
              value={kind}
              className="board-material-view-tab"
              aria-label={materialViewLabels[kind]}
              aria-expanded={open && view === kind}
              onMouseDown={(event) => {
                if (event.button === 0 && !event.ctrlKey && kind === view)
                  onOpenChange?.(pinned || !open);
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "Enter" || event.key === " ") &&
                  kind === view
                )
                  onOpenChange?.(pinned || !open);
              }}
            >
              <Icon size={20} aria-hidden />
              <span>{materialViewLabels[kind]}</span>
              {count !== undefined && (
                <small aria-label={`${count} 项`}>{count}</small>
              )}
              {count === undefined && kind !== "storyboard" && (
                <small aria-label="数量暂不可用">—</small>
              )}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
      {open && (
        <Tabs.Content key={view} value={view} className="board-material-pane">
          <div className="board-material-pane-heading">
            <h3 className="board-material-view-title">
              {materialViewLabels[view]}
            </h3>
            {onPinnedChange && (
              <button
                type="button"
                className="material-panel-pin"
                aria-label={pinned ? "取消固定素材面板" : "固定素材面板"}
                aria-pressed={pinned}
                onClick={() => onPinnedChange(!pinned)}
              >
                <Pin size={18} aria-hidden />
              </button>
            )}
            {onOpenChange && (
              <button type="button" aria-label="收起素材面板" onClick={close}>
                <X size={16} />
              </button>
            )}
          </div>
          <label className="board-search">
            <Search size={16} aria-hidden />
            <input
              aria-label={`搜索${materialViewLabels[view]}`}
              placeholder={`搜索${materialViewLabels[view]}…`}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <div className="board-material-content">{children}</div>
          {footer}
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
