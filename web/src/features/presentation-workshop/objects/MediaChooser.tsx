import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { listMedia, uploadImage } from "../api";
import { presentationKeys } from "../queryKeys";

export function MediaChooser({
  kind,
  value,
  change,
  label,
}: {
  kind: "image" | "audio" | "video";
  value: string | null;
  change: (id: string) => void;
  label: string;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const files = useQuery({
    queryKey: presentationKeys.mediaSearch(kind, query),
    queryFn: ({ signal }) => listMedia(kind, query, signal),
  });
  return (
    <div className="presentation-object-media">
      <input
        aria-label={`搜索${label}`}
        value={query}
        placeholder="搜索当前空间文件库"
        onChange={(e) => setQuery(e.target.value)}
      />
      <CustomSelect
        ariaLabel={label}
        value={value ?? ""}
        options={[
          {
            value: "",
            label: files.isPending ? "正在读取文件库…" : "选择文件库素材",
            disabled: true,
          },
          ...(value && !files.data?.items.some((f) => f.id === value)
            ? [{ value, label: "当前素材" }]
            : []),
          ...(files.data?.items ?? []).map((f) => ({
            value: f.id,
            label: f.display_name,
          })),
        ]}
        onChange={change}
      />
      <label className="btn presentation-object-upload">
        {busy ? "上传中…" : `上传${label}`}
        <input
          aria-label={`上传${label}`}
          type="file"
          hidden
          disabled={busy}
          accept={`${kind}/*`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            void uploadImage(file)
              .then((asset) => {
                if (!mounted.current) return;
                change(asset.id);
                void files.refetch();
              })
              .catch((e) => {
                if (mounted.current)
                  setError(e instanceof Error ? e.message : "上传失败");
              })
              .finally(() => {
                if (mounted.current) setBusy(false);
              });
          }}
        />
      </label>
      {(error || files.isError) && (
        <p role="alert">{error || "文件库读取失败"}</p>
      )}
    </div>
  );
}
