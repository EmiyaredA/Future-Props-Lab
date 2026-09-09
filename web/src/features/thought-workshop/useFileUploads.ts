import { useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { uploadAttachment, uploadImage } from "./api";

export type UploadEntry = {
  id: number;
  file: File;
  position: number;
  status: "waiting" | "uploading" | "failed";
  error?: string;
};
/** Positions follow every document transaction; no temporary nodes enter history or autosave. */
export function useFileUploads(editor: Editor | null) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const queue = useRef<UploadEntry[]>([]);
  const sequence = useRef(0);
  const active = useRef(false);
  const running = useRef(false);
  const publish = () => {
    if (active.current) setEntries(queue.current.map((e) => ({ ...e })));
  };
  useEffect(() => {
    if (!editor) return;
    active.current = true;
    const map = ({ transaction }: { transaction: Transaction }) => {
      for (const entry of queue.current)
        entry.position = transaction.mapping.map(entry.position, 1);
    };
    editor.on("transaction", map);
    return () => {
      active.current = false;
      queue.current = [];
      editor.off("transaction", map);
    };
  }, [editor]);
  const process = async () => {
    if (!editor || running.current) return;
    running.current = true;
    try {
      while (active.current && !editor.isDestroyed) {
        const entry = queue.current.find((e) => e.status === "waiting");
        if (!entry) break;
        entry.status = "uploading";
        publish();
        try {
          let content: JSONContent;
          if (
            entry.file.type.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif)$/i.test(entry.file.name)
          ) {
            const result = await uploadImage(entry.file);
            content = {
              type: "image",
              attrs: {
                assetId: result.asset_id,
                alt: entry.file.name,
                width: 480,
              },
            };
          } else {
            const result = await uploadAttachment(entry.file);
            content = {
              type: "attachment",
              attrs: {
                assetId: result.asset_id,
                filename: result.filename,
                mimeType: result.mime_type,
                byteSize: result.byte_size,
              },
            };
          }
          if (!active.current || editor.isDestroyed) return;
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.commands.insertContentAt(entry.position, content, {
            updateSelection: false,
          });
          queue.current = queue.current.filter((e) => e !== entry);
        } catch (e) {
          entry.status = "failed";
          entry.error = e instanceof Error ? e.message : "上传失败";
        }
        publish();
      }
    } finally {
      running.current = false;
    }
  };
  return {
    entries,
    enqueue(files: File[], position = editor?.state.selection.from ?? 0) {
      queue.current.push(
        ...files.map((file) => ({
          id: sequence.current++,
          file,
          position,
          status: "waiting" as const,
        })),
      );
      publish();
      void process();
    },
    retry(id: number) {
      const entry = queue.current.find((e) => e.id === id);
      if (entry) {
        entry.status = "waiting";
        entry.error = undefined;
        publish();
        void process();
      }
    },
    dismiss(id: number) {
      queue.current = queue.current.filter((e) => e.id !== id);
      publish();
    },
  };
}
