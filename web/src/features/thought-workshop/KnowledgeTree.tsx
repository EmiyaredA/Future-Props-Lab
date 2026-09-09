import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderInput,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { Directory, Move } from "./knowledgeApi";
import type { NoteSummary } from "./api";
import "./knowledge-tree.css";

type DropMode = "before" | "into" | "after";

function DocumentActionMenu({
  item,
  canMoveUp,
  canMoveDown,
  choose,
}: {
  item: NoteSummary;
  canMoveUp: boolean;
  canMoveDown: boolean;
  choose: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const place = () => {
      const anchor = trigger.current;
      const popup = menu.current;
      if (!anchor || !popup) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportRight =
        viewportLeft + (window.visualViewport?.width ?? window.innerWidth);
      const viewportBottom =
        viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      const right = anchorRect.right + 8;
      const left =
        right + popupRect.width <= viewportRight - 12
          ? right
          : Math.max(viewportLeft + 12, anchorRect.left - popupRect.width - 8);
      const top = Math.max(
        viewportTop + 12,
        Math.min(anchorRect.top, viewportBottom - popupRect.height - 12),
      );
      setPosition({ left, top });
    };
    place();
    const reposition = () => place();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    menu.current
      .querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      )
      ?.focus();
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        setOpen(false);
    };
    const closeWithEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ),
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };
  const run = (value: string) => {
    setOpen(false);
    choose(value);
  };

  return (
    <div className={`knowledge-tree-actions${open ? " is-open" : ""}`}>
      <button
        ref={trigger}
        type="button"
        className="knowledge-tree-action-trigger"
        aria-label={`${item.title}操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              className="knowledge-tree-action-menu"
              role="menu"
              aria-label={`${item.title}操作`}
              onKeyDown={handleMenuKey}
              style={
                position
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => run("new-document")}
              >
                <FilePlus2 aria-hidden />
                新建子文档
              </button>
              <div className="knowledge-tree-action-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => run("move")}>
                <FolderInput aria-hidden />
                移动到…
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canMoveUp}
                onClick={() => run("up")}
              >
                <ArrowUp aria-hidden />
                上移
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canMoveDown}
                onClick={() => run("down")}
              >
                <ArrowDown aria-hidden />
                下移
              </button>
              <div className="knowledge-tree-action-divider" role="separator" />
              <button
                type="button"
                className="is-danger"
                role="menuitem"
                onClick={() => run("delete")}
              >
                <Trash2 aria-hidden />
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function KnowledgeTree({
  directory,
  activeId,
  open,
  action,
  move,
}: {
  directory: Directory;
  activeId?: string;
  open: (id: string) => void;
  action: (action: string, item: NoteSummary) => void;
  move: (body: Omit<Move, "expected_revision">) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: DropMode } | null>(null);
  const byParent = useMemo(() => {
    const map = new Map<string | null, NoteSummary[]>();
    for (const doc of directory.documents) {
      const key = doc.parent_id;
      const list = map.get(key) || [];
      list.push(doc);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    return map;
  }, [directory.documents]);
  const descendants = (id: string) => {
    const found = new Set<string>();
    const walk = (parent: string) => {
      for (const child of byParent.get(parent) || []) {
        if (found.has(child.id)) continue;
        found.add(child.id);
        walk(child.id);
      }
    };
    walk(id);
    return found;
  };
  const toggle = (id: string) => {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const applyDrop = (target: NoteSummary, mode: DropMode) => {
    if (!dragId || dragId === target.id) return;
    if (descendants(dragId).has(target.id)) return;
    if (mode === "into") {
      move({ item_id: dragId, parent_id: target.id });
      setCollapsed((old) => {
        const next = new Set(old);
        next.delete(target.id);
        return next;
      });
    } else {
      const siblings = byParent.get(target.parent_id) || [];
      const index = siblings.findIndex((item) => item.id === target.id);
      const before =
        mode === "before" ? target.id : (siblings[index + 1]?.id ?? null);
      move({
        item_id: dragId,
        parent_id: target.parent_id,
        before_id: before,
      });
    }
    setDragId(null);
    setDrop(null);
  };
  const zoneFor = (event: DragEvent<HTMLDivElement>): DropMode => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < rect.height * 0.28) return "before";
    if (y > rect.height * 0.72) return "after";
    return "into";
  };
  const branch = (parent: string | null, depth = 0) => {
    const items = byParent.get(parent) || [];
    return items.map((item) => {
      const children = byParent.get(item.id) || [];
      const expanded = !collapsed.has(item.id);
      const dropMode = drop?.id === item.id ? drop.mode : null;
      return (
        <div key={item.id} className="knowledge-tree-node">
          <div
            className={[
              "knowledge-tree-row",
              activeId === item.id ? "active" : "",
              dragId === item.id ? "dragging" : "",
              dropMode === "into" ? "drop-into" : "",
              dropMode === "before" ? "drop-before" : "",
              dropMode === "after" ? "drop-after" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ paddingLeft: 8 + Math.min(depth, 8) * 14 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", item.id);
              e.dataTransfer.effectAllowed = "move";
              setDragId(item.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDrop(null);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === item.id) return;
              if (descendants(dragId).has(item.id)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const mode = zoneFor(e);
              if (drop?.id !== item.id || drop.mode !== mode)
                setDrop({ id: item.id, mode });
            }}
            onDragLeave={() => {
              if (drop?.id === item.id) setDrop(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              applyDrop(item, zoneFor(e));
            }}
          >
            {children.length ? (
              <button
                type="button"
                className="knowledge-tree-chevron"
                aria-label={expanded ? "折叠子文档" : "展开子文档"}
                aria-expanded={expanded}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(item.id);
                }}
              >
                {expanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ) : (
              <span className="knowledge-tree-chevron-spacer" />
            )}
            <button
              type="button"
              className="knowledge-tree-name"
              title={item.title}
              aria-current={activeId === item.id ? "page" : undefined}
              onClick={() => open(item.id)}
            >
              <FileText size={15} />
              <span>{item.title}</span>
            </button>
            <DocumentActionMenu
              item={item}
              canMoveUp={items.findIndex((i) => i.id === item.id) > 0}
              canMoveDown={
                items.findIndex((i) => i.id === item.id) < items.length - 1
              }
              choose={(value) => {
                if (value === "up" || value === "down") {
                  const index = items.findIndex((i) => i.id === item.id);
                  const target = value === "up" ? index - 1 : index + 2;
                  if (
                    (value === "up" && index === 0) ||
                    (value === "down" && index === items.length - 1)
                  )
                    return;
                  move({
                    item_id: item.id,
                    parent_id: parent,
                    before_id: items[target]?.id ?? null,
                  });
                } else action(value, item);
              }}
            />
          </div>
          {expanded && children.length > 0 && branch(item.id, depth + 1)}
        </div>
      );
    });
  };
  return (
    <nav
      aria-label="知识库目录"
      className="knowledge-tree"
      onDragOver={(e) => {
        if (dragId) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragId) move({ item_id: dragId, parent_id: null });
        setDragId(null);
        setDrop(null);
      }}
    >
      {branch(null)}
      {!directory.documents.length && (
        <p className="knowledge-empty-tree">
          还没有文档
          <br />
          从一个想法开始，建立你的知识库。
        </p>
      )}
    </nav>
  );
}
