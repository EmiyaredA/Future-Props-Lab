import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { InsertCommand } from "./blockCommands";
import { INSERT_COMMANDS } from "./blockCommands";

export type BlockInsertMenuHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

export const BlockInsertMenu = forwardRef<
  BlockInsertMenuHandle,
  {
    items?: InsertCommand[];
    query?: string;
    command: (item: InsertCommand) => void;
    searchable?: boolean;
    onClose?: () => void;
  }
>(function BlockInsertMenu(
  { items = INSERT_COMMANDS, query = "", command, searchable = false, onClose },
  forwardedRef,
) {
  const [localQuery, setLocalQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const needle = (searchable ? localQuery : query).trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.description} ${item.keywords}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, localQuery, query, searchable]);

  useEffect(() => setActive(0), [query, localQuery]);
  useEffect(() => {
    if (searchable) input.current?.focus();
  }, [searchable]);

  const choose = (index: number) => {
    const item = visible[index];
    if (item) command(item);
  };
  const onKeyDown = (event: KeyboardEvent | ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => {
        if (!visible.length) return 0;
        return (
          (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) %
          visible.length
        );
      });
      return true;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : Math.max(0, visible.length - 1));
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return true;
    }
    return false;
  };
  useImperativeHandle(forwardedRef, () => ({ onKeyDown }));

  return (
    <div className="thought-insert-menu" role="dialog" aria-label="插入内容">
      {searchable ? (
        <label className="thought-insert-search">
          <span className="sr-only">筛选插入内容</span>
          <input
            ref={input}
            value={localQuery}
            placeholder="搜索块类型…"
            onChange={(event) => setLocalQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      ) : null}
      <div
        className="thought-insert-menu-list"
        role="listbox"
        aria-label="可插入的块"
      >
        {visible.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={index === active}
            className={index === active ? "is-active" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span className="thought-insert-glyph" aria-hidden>
              {item.glyph}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
        {!visible.length ? (
          <p className="thought-insert-empty">没有匹配的块</p>
        ) : null}
      </div>
      <p className="thought-insert-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</p>
    </div>
  );
});
