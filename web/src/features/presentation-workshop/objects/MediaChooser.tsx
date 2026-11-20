import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { Search } from "lucide-react";
import { LoadingState } from "@shared/ui/LoadingState";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchablePickerDialog } from "@shared/ui/SearchablePickerDialog";
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
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ id: string; label: string }>();
  const search = useDeferredValue(query);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const files = useQuery({
    queryKey: presentationKeys.mediaSearch(kind, search),
    queryFn: ({ signal }) => listMedia(kind, search, signal),
    enabled: open,
  });
  return (
    <div className="presentation-object-media">
      <TransferFeedback progress={activeTransferProgress} />

      <button
        type="button"
        className="searchable-picker-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span>
          {value
            ? selection?.id === value
              ? selection.label
              : `更换${label}`
            : `选择${label}`}
        </span>
        <Search size={15} aria-hidden />
      </button>
      {open && (
        <SearchablePickerDialog
          title={`选择${label}`}
          searchLabel={`搜索${label}`}
          value={value}
          items={(files.data?.items ?? []).map((file) => ({
            id: file.id,
            label: file.display_name,
            keywords: file.original_filename,
            icon: kind,
            preview:
              kind !== "audio" ? `/v1/files/${file.id}/thumbnail` : undefined,
          }))}
          onSearch={setQuery}
          loading={files.isPending || query !== search}
          error={files.isError ? "文件库读取失败" : undefined}
          onClose={() => setOpen(false)}
          onChoose={(item) => {
            if (!item) return;
            setSelection(item);
            change(item.id);
          }}
        />
      )}
      <label className="btn presentation-object-upload">
        {busy ? (
          <LoadingState variant="inline" label="上传中…" />
        ) : (
          `上传${label}`
        )}
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
            void runTransfer((onProgress) => uploadImage(file, { onProgress }))
              .then((asset) => {
                if (!mounted.current) return;
                change(asset.id);
                setSelection({ id: asset.id, label: asset.display_name });
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
