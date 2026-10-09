import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ReferenceDropNotice as ReferenceDropNoticeState } from "./useProjectReferenceDrop";

export function ReferenceDropNotice({
  notice,
}: {
  notice: ReferenceDropNoticeState | null;
}) {
  const [dismissedId, setDismissedId] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setDismissedId(notice.id), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice || dismissedId === notice.id) return null;
  return (
    <div
      className={`reference-drop-notice is-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => setDismissedId(notice.id)}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
