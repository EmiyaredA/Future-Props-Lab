import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Editor } from "@tiptap/react";
import { SlideTextEditor } from "../SlideTextEditor";
import { SelectionTextTools } from "../SelectionTextTools";
import { defaultRun, newElement } from "../templates";
import type { Paragraph } from "../types";
import "../objects/objects.css";
export function RichNotesDialog({
  notes,
  paragraphs,
  onApply,
  onClose,
}: {
  notes: string;
  paragraphs?: Paragraph[] | null;
  onApply: (paragraphs: Paragraph[]) => void;
  onClose: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [element, setElement] = useState(() =>
    newElement("text", {
      x: 0,
      y: 0,
      width: 560,
      height: 260,
      paragraphs:
        paragraphs ??
        notes.split("\n").map((text) => ({
          align: "left",
          line_height: 1.3,
          bullet: false,
          numbered: false,
          runs: [{ ...defaultRun(text), size: 20 }],
        })),
    }),
  );
  const [editor, setEditor] = useState<Editor | null>(null),
    [composing, setComposing] = useState(false);
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
            <Dialog.Title>富文本演讲者备注</Dialog.Title>
            <Dialog.Close className="btn" onClick={onClose}>
              关闭
            </Dialog.Close>
          </header>
          <Dialog.Description>
            备注样式保留在文稿与 PPTX 中，不显示在观众画面。
          </Dialog.Description>
          <div className="presentation-dialog-body">
            <div
              role="toolbar"
              aria-label="备注格式"
              className="presentation-selection-toolbar"
            >
              <SelectionTextTools
                element={element}
                editor={editor}
                patch={(patch) => setElement({ ...element, ...patch })}
              />
            </div>
            <div className="presentation-rich-notes-editor">
              <SlideTextEditor
                localHistory
                element={element}
                onReady={setEditor}
                onComposition={setComposing}
                onExit={() => editor?.commands.blur()}
                onChange={(paragraphs) =>
                  setElement((current) => ({ ...current, paragraphs }))
                }
              />
            </div>
          </div>
          <footer>
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={composing}
              onClick={() => {
                onApply(element.paragraphs);
                onClose();
              }}
            >
              应用备注
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
