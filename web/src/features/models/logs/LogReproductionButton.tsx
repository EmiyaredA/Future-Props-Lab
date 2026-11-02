import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { Download } from "lucide-react";
import { downloadLogReproduction, type CallLog } from "@features/models/api";
import { apiErrorMessage } from "@platform/api/errors";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LogReproductionButton({ log }: { log: CallLog }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const supported = log.reproduction_supported;
  const note = supported
    ? "包含脚本、请求快照与中文 README，不包含密钥。"
    : log.reproduction_reason;

  const download = async () => {
    setPending(true);
    setError("");
    try {
      const blob = await downloadLogReproduction(log.id);
      saveBlob(blob, `model-repro-${log.id.slice(0, 8)}.zip`);
    } catch (reason) {
      setError(apiErrorMessage(reason, "复现包导出失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="log-reproduction-action">
      <button
        type="button"
        className="btn"
        disabled={!supported || pending}
        title={note}
        onClick={() => void download()}
      >
        <Download aria-hidden />
        {pending ? (
          <LoadingState variant="inline" label="正在生成…" />
        ) : (
          "导出复现包"
        )}
      </button>
      <small
        className={error ? "danger-text" : ""}
        role={error ? "alert" : undefined}
      >
        {error || note}
      </small>
    </div>
  );
}
