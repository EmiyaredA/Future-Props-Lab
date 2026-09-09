import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  listWritingModels,
  writeWithAI,
  type AssistantInput,
  type Note,
} from "./api";
import { thoughtKeys } from "./queryKeys";
import { parseMarkdown } from "./markdown";

export function WritingAssistant({
  editor,
  save,
  onModels,
  close,
}: {
  editor: Editor | null;
  save: () => Promise<Note>;
  onModels: () => void;
  close: () => void;
}) {
  const panel = useDrawerFocus(close);
  const models = useQuery({
    queryKey: thoughtKeys.models(),
    queryFn: ({ signal }) => listWritingModels(signal),
    retry: false,
  });
  const [model, setModel] = useState("");
  const [action, setAction] = useState<AssistantInput["action"]>("summary");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("document");
  const [stale, setStale] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const snapshot = useRef<{
    document: string;
    from: number;
    to: number;
  } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!editor) return;
    const updated = () => {
      if (snapshot.current)
        setStale(
          JSON.stringify(editor.getJSON()) !== snapshot.current.document,
        );
    };
    editor.on("update", updated);
    return () => {
      editor.off("update", updated);
    };
  }, [editor]);
  const run = async () => {
    if (!editor) return;
    const selected = editor.state.selection;
    if (scope === "selection" && selected.empty) {
      setError("请先在正文中选择一段文字");
      return;
    }
    snapshot.current = {
      document: JSON.stringify(editor.getJSON()),
      from: selected.from,
      to: selected.to,
    };
    const selection =
      scope === "selection"
        ? editor.state.doc.textBetween(
            selected.from,
            selected.to,
            "\n",
            (node) => String(node.attrs.latex || node.attrs.source || ""),
          )
        : "";
    setBusy(true);
    setError("");
    setResult("");
    setStale(false);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const note = await save();
      if (abort.signal.aborted) return;
      if (JSON.stringify(editor.getJSON()) !== snapshot.current.document)
        throw new Error("正文已变化，请重新发起生成");
      await writeWithAI(
        note.id,
        {
          model_id: model || models.data?.[0]?.id || "",
          action,
          instruction,
          selection,
          expected_revision: note.revision,
        },
        abort.signal,
        (text) => setResult((v) => v + text),
      );
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };
  const apply = (replace: boolean) => {
    if (!editor || !result) return;
    const normalize = (
      node: import("@tiptap/core").JSONContent,
      parent = "doc",
    ): import("@tiptap/core").JSONContent => {
      if (node.type === "image") {
        const text = {
          type: "text",
          text: String(node.attrs?.alt || "图片建议，请手动上传图片"),
        };
        return ["paragraph", "heading", "detailsSummary"].includes(parent)
          ? text
          : { type: "paragraph", content: [text] };
      }
      return {
        ...node,
        ...(node.content
          ? {
              content: node.content.map((child) => normalize(child, node.type)),
            }
          : {}),
      };
    };
    const content = normalize(parseMarkdown(result)).content || [];
    if (replace) {
      const captured = snapshot.current;
      if (
        !captured ||
        captured.from === captured.to ||
        JSON.stringify(editor.getJSON()) !== captured.document
      ) {
        setStale(true);
        return;
      }
      editor
        .chain()
        .focus()
        .insertContentAt({ from: captured.from, to: captured.to }, content)
        .run();
    } else
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, content)
        .run();
  };
  return (
    <aside ref={panel} className="thought-assistant" aria-label="AI 写作助手">
      <header>
        <div>
          <h2>写作助手</h2>
          <p>围绕当前笔记，延续你的思路</p>
        </div>
        <button onClick={close} aria-label="关闭写作助手">
          ×
        </button>
      </header>
      {models.isPending ? (
        <p>正在加载模型…</p>
      ) : !models.data?.length ? (
        <div className="thought-empty">
          <p>{models.isError ? "模型列表加载失败" : "尚无可用文本模型"}</p>
          <button className="btn" onClick={onModels}>
            配置模型
          </button>
        </div>
      ) : (
        <>
          <CustomSelect
            ariaLabel="写作模型"
            value={model || models.data[0].id}
            options={models.data.map((m) => ({ value: m.id, label: m.label }))}
            onChange={setModel}
            disabled={busy}
          />
          <CustomSelect
            ariaLabel="处理范围"
            value={scope}
            options={[
              { value: "document", label: "整篇笔记" },
              { value: "selection", label: "选中的文字" },
            ]}
            onChange={setScope}
            disabled={busy}
          />
          <div className="thought-ai-actions">
            {Object.entries({
              summary: "提炼摘要",
              polish: "润色文字",
              continue: "继续写作",
              tasks: "整理待办",
              custom: "自定义",
            }).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={action === key}
                disabled={busy}
                onClick={() => setAction(key as AssistantInput["action"])}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            aria-label="写作要求"
            placeholder="补充写作要求…"
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy}
          />
          <button
            className="btn primary"
            disabled={busy || !editor}
            onClick={() => void run()}
          >
            生成建议
          </button>
          {busy && (
            <button className="btn" onClick={() => controller.current?.abort()}>
              停止生成
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="thought-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="thought-ai-result">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          </div>
          {stale && (
            <p role="status">正文已变化，建议可追加，不能替换原选区。</p>
          )}
          <div className="thought-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => apply(false)}
            >
              追加到笔记
            </button>
            <button
              className="btn"
              disabled={busy || stale || scope !== "selection"}
              onClick={() => apply(true)}
            >
              替换选区
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
