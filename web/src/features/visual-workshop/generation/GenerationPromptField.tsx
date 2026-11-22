import {
  type ComponentProps,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Copy, Info, ScanText, Text } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { GenerationPromptEditor } from "./GenerationPromptEditor";
import { PromptVersionControls } from "./PromptVersionControls";
import type { usePromptVersions } from "./usePromptVersions";
import {
  promptRenderAdapters,
  resolvePromptRendering,
} from "./promptRendering";
import { promptRenderViews } from "./promptRenderViews";
import type { PromptReferenceSlots } from "./promptRendering";
import "./prompt-rendering.css";

export function GenerationPromptField({
  versions,
  referenceSlots,
  ...props
}: ComponentProps<typeof GenerationPromptEditor> & {
  versions?: ReturnType<typeof usePromptVersions>;
  referenceSlots?: PromptReferenceSlots;
}) {
  const [template, setTemplate] = useState("auto");
  const [displayMode, setDisplayMode] = useState<"rendered" | "plain">(
    "rendered",
  );
  const [copyNotice, setCopyNotice] = useState("");
  const [editingAdapter, setEditingAdapter] = useState<string>();
  const expectedEdit = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const ownsFocus = useRef(false);
  const [inserted, setInserted] = useState<string>();
  const { value: currentValue, onBlur: saveEditor } = props;
  useEffect(() => {
    if (inserted !== undefined && currentValue === inserted) {
      setInserted(undefined);
      saveEditor?.();
      root.current
        ?.querySelector<HTMLElement>(".prompt-render-editor")
        ?.focus();
    }
  }, [inserted, currentValue, saveEditor]);
  const rendering = useMemo(() => {
    const parsed = resolvePromptRendering(props.value, template);
    if (parsed) return parsed;
    const adapter =
      expectedEdit.current === props.value
        ? promptRenderAdapters.find((item) => item.id === editingAdapter)
        : undefined;
    return adapter
      ? {
          adapter,
          document: {
            sections: [
              {
                heading: "",
                blocks: [
                  {
                    kind: "paragraph" as const,
                    tokens: [{ kind: "text" as const, text: props.value }],
                  },
                ],
              },
            ],
          },
        }
      : null;
  }, [props.value, template, editingAdapter]);
  useEffect(() => {
    if (expectedEdit.current !== currentValue) setEditingAdapter(undefined);
  }, [currentValue]);
  const renderView = rendering
    ? promptRenderViews[rendering.adapter.id]
    : undefined;
  const mentions = useMemo(
    () =>
      rendering && renderView
        ? renderView.mentions(rendering.document, props.assets, referenceSlots)
        : undefined,
    [rendering, renderView, props.assets, referenceSlots],
  );
  const RenderedEditor = renderView?.Editor;
  const rich = displayMode === "rendered" && Boolean(RenderedEditor);
  useLayoutEffect(() => {
    if (!ownsFocus.current) return;
    if (
      document.activeElement !== document.body &&
      !(document.activeElement as HTMLElement | null)?.isContentEditable &&
      document.activeElement?.getAttribute("contenteditable") !== "true"
    )
      return;
    const editor = root.current?.querySelector<HTMLElement>('[role="textbox"]');
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [rich]);

  const copySource = async () => {
    setCopyNotice("");
    try {
      await navigator.clipboard.writeText(props.value);
      setCopyNotice("已复制原文");
    } catch {
      setCopyNotice("复制失败，请切换到普通文本后选择复制。");
    }
  };

  return (
    <div
      ref={root}
      className="generation-prompt-field"
      onFocusCapture={() => {
        ownsFocus.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          ownsFocus.current = false;
      }}
    >
      <div
        className="prompt-render-toolbar"
        role="group"
        aria-label="提示词显示"
      >
        {versions && <PromptVersionControls versions={versions} inline />}
        <CustomSelect
          ariaLabel="提示词渲染模板"
          className="prompt-render-select"
          menuMinWidth={180}
          value={template}
          options={[
            {
              value: "auto",
              label: rendering
                ? `自动 · ${rendering.adapter.shortLabel ?? rendering.adapter.label}`
                : "自动识别",
            },
            ...promptRenderAdapters.map((adapter) => ({
              value: adapter.id,
              label: adapter.label,
            })),
          ]}
          onChange={(value) => {
            setTemplate(value);
            setEditingAdapter(undefined);
            expectedEdit.current = undefined;
            setCopyNotice("");
          }}
        />
        <div className="prompt-render-actions">
          <button
            type="button"
            role="switch"
            aria-label="渲染提示词"
            aria-checked={displayMode === "rendered"}
            title={
              displayMode === "rendered" ? "切换为普通文本" : "切换为渲染展示"
            }
            onClick={() => {
              setDisplayMode((current) =>
                current === "rendered" ? "plain" : "rendered",
              );
              setEditingAdapter(undefined);
              expectedEdit.current = undefined;
              setCopyNotice("");
            }}
          >
            {displayMode === "rendered" ? (
              <ScanText size={14} aria-hidden />
            ) : (
              <Text size={14} aria-hidden />
            )}
          </button>
          {renderView && (
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button type="button" aria-label="提示词编辑说明">
                    <Info size={14} aria-hidden />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="prompt-render-help"
                    sideOffset={6}
                  >
                    {renderView.help}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )}
          <button
            type="button"
            aria-label="复制原文"
            title="复制原文"
            onClick={() => void copySource()}
          >
            <Copy size={14} aria-hidden />
            <span>复制</span>
          </button>
        </div>
      </div>
      {displayMode === "rendered" && template !== "auto" && !rendering ? (
        <p className="prompt-render-notice" role="status">
          未识别到{" "}
          {
            promptRenderAdapters.find((adapter) => adapter.id === template)
              ?.label
          }{" "}
          段落，当前显示原文。
        </p>
      ) : null}
      {copyNotice ? (
        <p className="prompt-render-notice" role="status">
          {copyNotice}
        </p>
      ) : null}
      {rich && rendering && RenderedEditor ? (
        <RenderedEditor
          value={props.value}
          document={rendering.document}
          assets={props.assets}
          referenceSlots={referenceSlots}
          mentions={mentions ?? []}
          label={props.label}
          maxLength={props.maxLength}
          onChange={(next) => {
            expectedEdit.current = next;
            setEditingAdapter(rendering.adapter.id);
            props.onChange(next);
          }}
          onBlur={props.onBlur}
          onInsert={(next) => {
            expectedEdit.current = next;
            setEditingAdapter(rendering.adapter.id);
            props.onChange(next);
            setInserted(next);
          }}
        />
      ) : (
        <GenerationPromptEditor
          {...props}
          onChange={(next) => {
            props.onChange(next);
            if (
              displayMode === "rendered" &&
              resolvePromptRendering(next, template)
            )
              setInserted(next);
          }}
          mentions={displayMode === "rendered" ? mentions : undefined}
          normalizeReferencesOnLoad={false}
        />
      )}
    </div>
  );
}
