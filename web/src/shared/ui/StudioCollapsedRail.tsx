import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "./studio-collapsed-rail.css";

export type StudioRailLeaf = {
  kind: "leaf";
  id: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  active?: boolean;
  onSelect: () => void;
};

export type StudioRailGroupItem = {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onSelect: () => void;
};

export type StudioRailGroup = {
  kind: "group";
  id: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  active?: boolean;
  onSelect?: () => void;
  items: StudioRailGroupItem[];
};

export type StudioRailEntry = StudioRailLeaf | StudioRailGroup;

type FlyoutPosition = {
  left: number;
  top: number;
  maxHeight: number;
};

export function StudioCollapsedRail({
  entries,
  routeKey,
  brand,
  onExpand,
  expandDisabled = false,
  labeled = false,
  preferFlyout = true,
  secondaryToggle,
  footer,
  label = "主导航",
}: {
  entries: StudioRailEntry[];
  routeKey: string;
  brand?: ReactNode;
  onExpand?: () => void;
  expandDisabled?: boolean;
  labeled?: boolean;
  preferFlyout?: boolean;
  secondaryToggle?: {
    collapsed: boolean;
    disabled?: boolean;
    label?: string;
    onToggle: () => void;
  };
  footer?: ReactNode;
  label?: string;
}) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [position, setPosition] = useState<FlyoutPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusMenuOnOpenRef = useRef(false);
  const openGroup =
    entries.find(
      (entry): entry is StudioRailGroup =>
        entry.kind === "group" && entry.id === openGroupId,
    ) ?? null;

  const closeFlyout = useCallback((restoreFocus = false) => {
    setOpenGroupId(null);
    setPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 8;
    const width = 216;
    const maxHeight = Math.max(
      160,
      Math.min(480, window.innerHeight - viewportPadding * 2),
    );
    const renderedHeight = Math.min(
      panel.scrollHeight || panel.offsetHeight,
      maxHeight,
    );
    const left = Math.min(
      rect.right + gap,
      Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
    );
    const top = Math.min(
      Math.max(viewportPadding, rect.top - 8),
      Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - renderedHeight,
      ),
    );
    setPosition({ left, top, maxHeight });
  }, []);

  useEffect(() => {
    closeFlyout(false);
  }, [closeFlyout, routeKey]);

  useEffect(() => {
    if (preferFlyout) return;
    closeFlyout(false);
  }, [closeFlyout, preferFlyout]);

  useEffect(() => {
    if (!openGroup) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      closeFlyout(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeFlyout(true);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeFlyout, openGroup]);

  useLayoutEffect(() => {
    if (!openGroup) return;
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      if (!focusMenuOnOpenRef.current) return;
      focusMenuOnOpenRef.current = false;
      const active = panelRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"][aria-current="page"]',
      );
      const first =
        panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      (active ?? first)?.focus();
    });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openGroup, updatePosition]);

  const showGroup = (
    group: StudioRailGroup,
    button: HTMLButtonElement,
    focusMenu: boolean,
  ) => {
    triggerRef.current = button;
    focusMenuOnOpenRef.current = focusMenu;
    setPosition(null);
    setOpenGroupId((current) => (current === group.id ? null : group.id));
  };

  const moveMenuFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (!buttons.length) return;
    const current = buttons.indexOf(event.currentTarget);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      closeFlyout(true);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const tipButton = (
    tip: string,
    content: ReactNode,
    props: {
      active?: boolean;
      expanded?: boolean;
      controls?: string;
      hasPopup?: boolean;
      onClick: (event: MouseEvent<HTMLButtonElement>) => void;
      onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
      disabled?: boolean;
    },
  ) => (
    <span
      className={`studio-rail-tooltip${labeled ? " is-labeled" : ""}`}
      data-tip={tip}
    >
      <button
        type="button"
        className={`studio-rail-button${props.active ? " is-active" : ""}`}
        aria-label={tip}
        aria-current={props.active ? "page" : undefined}
        aria-haspopup={props.hasPopup ? "menu" : undefined}
        aria-expanded={props.controls ? props.expanded : undefined}
        aria-controls={props.controls}
        disabled={props.disabled}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
      >
        {content}
      </button>
    </span>
  );

  const entryContent = (entry: StudioRailEntry) => (
    <>
      <span className="studio-rail-button__icon" aria-hidden>
        {entry.icon}
      </span>
      {labeled ? (
        <span className="studio-rail-button__label">
          {entry.shortLabel ?? entry.label}
        </span>
      ) : null}
    </>
  );

  const flyout = openGroup ? (
    <div
      ref={panelRef}
      id={`studio-rail-flyout-${openGroup.id}`}
      className="studio-rail-flyout"
      role="menu"
      aria-label={openGroup.label}
      style={{
        position: "fixed",
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width: 216,
        maxHeight: position?.maxHeight ?? "calc(100vh - 16px)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="studio-rail-flyout__title">
        <span className="studio-rail-flyout__title-icon" aria-hidden>
          {openGroup.icon}
        </span>
        <span>{openGroup.label}</span>
      </div>
      <div className="studio-rail-flyout__items">
        {openGroup.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`studio-rail-flyout__item${item.active ? " is-active" : ""}`}
            role="menuitem"
            aria-current={item.active ? "page" : undefined}
            onClick={() => {
              closeFlyout(false);
              item.onSelect();
            }}
            onKeyDown={moveMenuFocus}
          >
            <span className="studio-rail-flyout__item-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const expandTip = expandDisabled ? "窄屏下保持图标栏" : "展开侧栏";
  const secondaryTip =
    secondaryToggle?.label ??
    (secondaryToggle?.disabled
      ? "当前分区无二级导航"
      : secondaryToggle?.collapsed
        ? "展开二级导航"
        : "收起二级导航");

  return (
    <div
      className={`studio-collapsed-rail${labeled ? " is-labeled" : ""}`}
      aria-label={label}
    >
      {brand || onExpand || secondaryToggle ? (
        <div className="studio-collapsed-rail__top">
          {brand ? (
            <div className="studio-collapsed-rail__brand">{brand}</div>
          ) : null}
          {secondaryToggle
            ? tipButton(
                secondaryTip,
                secondaryToggle.collapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                ),
                {
                  disabled: secondaryToggle.disabled,
                  expanded: !secondaryToggle.collapsed,
                  onClick: () => secondaryToggle.onToggle(),
                },
              )
            : null}
          {onExpand
            ? tipButton(expandTip, <PanelLeftOpen size={18} />, {
                disabled: expandDisabled,
                onClick: () => onExpand(),
              })
            : null}
        </div>
      ) : null}
      <nav className="studio-collapsed-rail__entries" aria-label="栏目导航">
        {entries.map((entry) =>
          entry.kind === "leaf" ? (
            <div key={entry.id}>
              {tipButton(entry.label, entryContent(entry), {
                active: entry.active,
                onClick: () => entry.onSelect(),
              })}
            </div>
          ) : (
            <div key={entry.id}>
              {preferFlyout
                ? tipButton(
                    `${entry.label}，点击展开菜单`,
                    entryContent(entry),
                    {
                      active: entry.active,
                      expanded: openGroupId === entry.id,
                      controls: `studio-rail-flyout-${entry.id}`,
                      hasPopup: true,
                      onClick: (event) =>
                        showGroup(
                          entry,
                          event.currentTarget,
                          event.detail === 0,
                        ),
                      onKeyDown: (event) => {
                        if (event.key !== "ArrowRight") return;
                        event.preventDefault();
                        showGroup(entry, event.currentTarget, true);
                      },
                    },
                  )
                : tipButton(entry.label, entryContent(entry), {
                    active: entry.active,
                    onClick: () => entry.onSelect?.(),
                  })}
            </div>
          ),
        )}
      </nav>
      {footer ? (
        <div className="studio-collapsed-rail__footer">{footer}</div>
      ) : null}
      {flyout ? createPortal(flyout, document.body) : null}
    </div>
  );
}
