import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Deck } from "../types";
import { replaceInDeck, searchDeck } from "./searchText";
import "../objects/objects.css";
export function SearchDialog({
  deck,
  readOnly,
  onReplace,
  onChoose,
  onClose,
}: {
  deck: Deck;
  readOnly: boolean;
  onReplace: (deck: Deck) => void;
  onChoose: (slide: string, element?: string) => void;
  onClose: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [caseSensitive, setCase] = useState(false);
  const matches = searchDeck(deck, query, caseSensitive);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="presentation-modal-backdrop" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={keepDialogEscapeLocal}
          className="presentation-dialog presentation-dialog-floating presentation-object-dialog"
          data-presentation-history="local"
        >
          <header>
            <Dialog.Title>查找与替换</Dialog.Title>
            <Dialog.Close className="btn" onClick={onClose}>
              关闭
            </Dialog.Close>
          </header>
          <Dialog.Description>
            查找页面文字、表格和备注，替换会保留文字样式并可整体撤销，锁定元素保持原样。
          </Dialog.Description>
          <div className="presentation-dialog-body">
            <div className="presentation-dialog-fields">
              <input
                aria-label="查找文字"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="btn"
                aria-pressed={caseSensitive}
                onClick={() => setCase(!caseSensitive)}
              >
                区分大小写
              </button>
            </div>
            {!readOnly && (
              <div className="presentation-object-actions">
                <input
                  aria-label="替换为"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={!query || !matches.length}
                  onClick={() => {
                    onReplace(
                      replaceInDeck(deck, query, replacement, caseSensitive),
                    );
                    onClose();
                  }}
                >
                  全部替换
                </button>
              </div>
            )}
            <p role="status">
              {matches.length} 个匹配对象
              {matches.length >= 200 ? "（最多显示 200 项）" : ""}
            </p>
            <ul className="presentation-dialog-report presentation-search-results">
              {matches.map((match, i) => (
                <li key={i}>
                  <button
                    className="btn"
                    onClick={() => {
                      onChoose(match.slideId, match.elementId);
                      onClose();
                    }}
                  >
                    第{" "}
                    {deck.slides.findIndex((s) => s.id === match.slideId) + 1}{" "}
                    页 · {match.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
