import { useEffect, useRef, useState } from "react";
import { previewSvg } from "./api";

export function SvgImport({
  initialFile,
  onConfirm,
  busy,
}: {
  initialFile?: File;
  onConfirm: (file: File) => Promise<void>;
  busy: boolean;
}) {
  const [source, setSource] = useState(""),
    [name, setName] = useState("自定义图标.svg"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [result, setResult] = useState<Awaited<
      ReturnType<typeof previewSvg>
    > | null>(null),
    [url, setUrl] = useState("");
  const controller = useRef<AbortController | null>(null);
  const fileRequest = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let active = true;
    if (initialFile && initialFile.size > 2 * 1024 * 1024) {
      setError("SVG 不能超过 2 MiB");
      return;
    }
    if (initialFile)
      void initialFile
        .text()
        .then((text) => {
          if (active) {
            setSource(text);
            setName(initialFile.name);
          }
        })
        .catch(() => {
          if (active) setError("读取 SVG 文件失败");
        });
    return () => {
      active = false;
    };
  }, [initialFile]);
  useEffect(() => {
    if (!result) return;
    const next = URL.createObjectURL(
      new Blob([result.svg], { type: "image/svg+xml" }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [result]);
  const preview = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const value = await previewSvg(source, request.signal);
      if (!request.signal.aborted) setResult(value);
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : "SVG 预览失败");
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  };
  return (
    <div className="presentation-svg-import">
      <label className="btn presentation-file-input">
        选择 SVG 文件
        <input
          type="file"
          accept=".svg,image/svg+xml"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              const sequence = ++fileRequest.current;
              controller.current?.abort();
              setPending(false);
              setResult(null);
              setError("");
              setSource("");
              setName(file.name);
              if (file.size > 2 * 1024 * 1024) {
                setError("SVG 不能超过 2 MiB");
                return;
              }
              try {
                const text = await file.text();
                if (sequence === fileRequest.current) setSource(text);
              } catch {
                setError("读取 SVG 文件失败");
              }
            }
          }}
        />
      </label>
      <textarea
        aria-label="SVG 代码"
        placeholder="粘贴 <svg>…</svg> 代码，或选择文件"
        value={source}
        maxLength={2 * 1024 * 1024}
        onChange={(e) => {
          fileRequest.current++;
          controller.current?.abort();
          setPending(false);
          setResult(null);
          setSource(e.target.value);
        }}
      />
      <p className="muted">
        支持路径、形状、渐变与蒙版。文字请先转路径，不支持外部资源、滤镜或动画。
      </p>
      <button
        className="btn"
        disabled={!source || pending || busy}
        onClick={() => void preview()}
      >
        {pending ? "检查中…" : "检查并预览"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <div className="presentation-svg-preview">
            <img src={url} alt="SVG 导入预览" />
          </div>
          <p>
            {result.width} × {result.height} ·{" "}
            {result.monochrome ? "单色，可改色" : "保留原始配色"}
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void onConfirm(
                new File(
                  [result.svg],
                  name.endsWith(".svg") ? name : `${name}.svg`,
                  { type: "image/svg+xml" },
                ),
              )
            }
          >
            {busy ? "正在导入…" : "确认导入"}
          </button>
        </>
      )}
    </div>
  );
}
