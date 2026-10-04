import { Check, Copy, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./prose.css";
export function CopyCode({ source }: { source: string }) {
  const [result, setResult] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <button
        type="button"
        className="document-copy-button"
        aria-label="复制代码"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(source);
            setResult("复制成功");
          } catch {
            setResult("复制失败，请手动选择内容复制");
          }
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setResult(""), 2400);
        }}
      >
        {result === "复制成功" ? <Check size={15} /> : <Copy size={15} />}
        {result === "复制成功" ? "已复制" : "复制"}
      </button>
      <span role="status" className="document-copy-feedback">
        {result}
      </span>
    </>
  );
}
export function CodeToolbar({
  source,
  language,
  children,
}: {
  source: string;
  language: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="document-code-toolbar" contentEditable={false}>
      {children ?? <span>{language || "纯文本"}</span>}
      <CopyCode source={source} />
    </div>
  );
}
export function CalloutHeading({
  variant,
  title,
}: {
  variant: string;
  title?: string;
}) {
  const Icon =
    variant === "tip" || variant === "success"
      ? Lightbulb
      : variant === "warning" || variant === "danger"
        ? TriangleAlert
        : Info;
  const defaults: Record<string, string> = {
    info: "信息",
    note: "说明",
    tip: "提示",
    success: "成功",
    warning: "注意",
    danger: "危险",
  };
  return (
    <div className="document-callout-title" contentEditable={false}>
      <Icon size={18} aria-hidden />
      <strong>{title || defaults[variant] || "说明"}</strong>
    </div>
  );
}
