import { useBackdropDismiss } from "@shared/ui/useBackdropDismiss";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  Check,
  File,
  Folder,
  Image,
  Music,
  Search,
  Video,
  X,
} from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { ImagePreview } from "./ImagePreview";
import { LoadingState } from "./LoadingState";
import "./searchable-picker.css";

export type PickerItem = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
  preview?: string;
  icon?: "image" | "video" | "audio" | "model" | "folder";
  disabled?: boolean;
};

const icons = {
  image: Image,
  video: Video,
  audio: Music,
  model: Box,
  folder: Folder,
};
const pageSize = 48;

export function SearchablePickerDialog({
  title,
  items,
  value,
  onClose,
  onChoose,
  searchLabel = "搜索素材",
  onSearch,
  toolbar,
  loading,
  error,
  clearLabel,
  renderChoice,
  multi,
  gallery = false,
}: {
  title: string;
  items: readonly PickerItem[];
  value?: string | null;
  onClose: () => void;
  onChoose: (item: PickerItem | null) => void | Promise<void>;
  searchLabel?: string;
  onSearch?: (query: string) => void;
  toolbar?: ReactNode;
  loading?: boolean;
  error?: string;
  clearLabel?: string;
  gallery?: boolean;
  multi?: {
    confirmLabel: string;
    max?: number;
    onChoose: (items: PickerItem[]) => void | Promise<void>;
  };
  renderChoice?: (
    item: PickerItem,
    control: { selected: boolean; disabled?: boolean; onSelect: () => void },
  ) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [selected, setSelected] = useState<PickerItem>();
  const [selection, setSelection] = useState<PickerItem[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const matches = items.filter(({ label, detail, keywords }) =>
    [label, detail, keywords].some((text) =>
      text?.toLocaleLowerCase().includes(normalized),
    ),
  );

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  function isSelected(item: PickerItem) {
    return multi
      ? selection.some((entry) => entry.id === item.id)
      : (selected?.id ?? value) === item.id;
  }

  function select(item: PickerItem) {
    if (!multi) {
      setSelected(item);
      return;
    }
    if (isSelected(item)) {
      setSelection(selection.filter(({ id }) => id !== item.id));
    } else if (selection.length >= (multi.max ?? Infinity)) {
      setNotice(`最多可选 ${multi.max} 项`);
      return;
    } else {
      setSelection([...selection, item]);
    }
    setNotice("");
  }

  async function choose(item: PickerItem | null) {
    setPending(true);
    setNotice("");
    try {
      if (multi) await multi.onChoose(selection);
      else await onChoose(item);
      onClose();
    } catch (failure) {
      setNotice(apiErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  const backdrop = useBackdropDismiss(() => {
    if (!pending) onClose();
  });
  return (
    <dialog
      className={`searchable-picker${gallery ? " searchable-picker--gallery" : ""}`}
      aria-label={title}
      ref={dialog}
      {...backdrop}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          aria-label={`关闭${title}`}
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="searchable-picker-tools" inert={pending || undefined}>
        <label className="searchable-picker-search">
          <Search size={16} aria-hidden />
          <input
            ref={input}
            type="search"
            aria-label={searchLabel}
            placeholder={`${searchLabel}…`}
            value={query}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setQuery(next);
              onSearch?.(next.trim());
              setLimit(pageSize);
              if (results.current) results.current.scrollTop = 0;
            }}
          />
        </label>
        {toolbar}
      </div>
      <div className="searchable-picker-results" ref={results}>
        {loading && <LoadingState variant="inline" label="正在读取…" />}
        {error && (
          <p className="searchable-picker-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && matches.length === 0 && (
          <p className="searchable-picker-empty" role="status">
            {normalized ? "没有匹配的结果" : "暂无可选内容"}
          </p>
        )}
        {renderChoice ? (
          <ul className="searchable-picker-list" aria-label="搜索结果">
            {matches.slice(0, limit).map((item) =>
              renderChoice(item, {
                selected: isSelected(item),
                disabled: pending || item.disabled,
                onSelect: () => select(item),
              }),
            )}
          </ul>
        ) : (
          <div
            className="searchable-picker-grid"
            role="group"
            aria-label="搜索结果"
          >
            {matches.slice(0, limit).map((item) => {
              const checked = isSelected(item);
              const Icon = item.icon ? icons[item.icon] : File;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={checked}
                  disabled={pending || item.disabled}
                  onClick={() => select(item)}
                >
                  <span className="searchable-picker-thumb">
                    {item.preview ? (
                      <ImagePreview
                        interactive={false}
                        src={item.preview}
                        size={gallery ? 320 : 128}
                      />
                    ) : (
                      <Icon size={22} aria-hidden />
                    )}
                  </span>
                  <span className="searchable-picker-item-name">
                    <strong title={item.label}>{item.label}</strong>
                    {item.detail && (
                      <small title={item.detail}>{item.detail}</small>
                    )}
                  </span>
                  {checked && <Check size={16} aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
        {matches.length > limit && (
          <button
            type="button"
            className="searchable-picker-more"
            onClick={() => setLimit(limit + pageSize)}
          >
            显示更多（{matches.length - limit}）
          </button>
        )}
      </div>
      {notice && (
        <p className="searchable-picker-error" role="alert">
          {notice}
        </p>
      )}
      {multi && selection.length > 0 && (
        <div className="searchable-picker-selected" aria-label="已选素材">
          {selection.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={pending}
              onClick={() => select(item)}
              aria-label={`移除 ${item.label}`}
            >
              {item.label} <X size={13} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <footer>
        <span aria-live="polite">
          {multi
            ? `已选 ${selection.length} 项`
            : (selected?.label ?? `${matches.length} 项`)}
        </span>
        <div>
          {clearLabel && value && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void choose(null)}
            >
              {clearLabel}
            </button>
          )}
          <button type="button" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="searchable-picker-confirm"
            disabled={pending || (multi ? !selection.length : !selected)}
            onClick={() => void choose(selected ?? null)}
          >
            {pending ? "正在处理…" : (multi?.confirmLabel ?? "确认选择")}
          </button>
        </div>
      </footer>
    </dialog>
  );
}

export function SearchablePickerField({
  title,
  items,
  value,
  onChange,
  disabled,
  searchLabel,
  placeholder,
}: {
  title: string;
  items: readonly PickerItem[];
  value?: string | null;
  onChange: (id: string) => void | Promise<void>;
  disabled?: boolean;
  searchLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        className="searchable-picker-trigger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span>
          {items.find(({ id }) => id === value)?.label ?? placeholder ?? title}
        </span>
        <Search size={15} aria-hidden />
      </button>
      {open && (
        <SearchablePickerDialog
          title={title}
          searchLabel={searchLabel}
          items={items}
          value={value}
          onClose={() => setOpen(false)}
          onChoose={(item) => {
            if (item) return onChange(item.id);
          }}
        />
      )}
    </>
  );
}
