import { LoadingState } from "@shared/ui/LoadingState";
import { lazy, Suspense, useRef, useState } from "react";
import { Upload } from "lucide-react";
const ImportDialog = lazy(() => import("./ImportDialog"));
export function ImportButton({ onOpen }: { onOpen: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null),
    [file, setFile] = useState<File | null>(null);
  return (
    <>
      <button
        type="button"
        className="workshop-secondary"
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden />
        导入文稿
      </button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label="选择导入文稿"
        accept=".pptx,.json,.fplppt"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) setFile(selected);
          e.target.value = "";
        }}
      />
      {file && (
        <Suspense
          fallback={<LoadingState label="正在加载导入工具…" variant="region" />}
        >
          <ImportDialog
            file={file}
            onClose={() => setFile(null)}
            onOpen={onOpen}
          />
        </Suspense>
      )}
    </>
  );
}
