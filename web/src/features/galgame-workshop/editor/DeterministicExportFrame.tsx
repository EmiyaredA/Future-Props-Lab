import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import {
  previewGalgameVideoExportFrame,
  type GalgameVideoExportPreviewRequest,
} from "@features/galgame-workshop/api";

export function DeterministicExportFrame({
  projectId,
  request,
  fingerprint,
}: {
  projectId: string;
  request: GalgameVideoExportPreviewRequest;
  fingerprint?: string;
}) {
  const [url, setUrl] = useState("");
  const frame = useQuery({
    queryKey: ["galgame-video-export-frame", projectId, fingerprint],
    queryFn: () =>
      previewGalgameVideoExportFrame(projectId, {
        ...request,
        timeMs: 0,
        width: 960,
      }),
    enabled: Boolean(fingerprint),
    retry: false,
  });
  useEffect(() => {
    if (!frame.data) return;
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(frame.data);
    setUrl(next);
    return () => URL.revokeObjectURL?.(next);
  }, [frame.data]);
  if (!fingerprint) return null;
  return (
    <section className="galgame-video-deterministic-frame">
      <header>
        <strong>确定性导出首帧</strong>
        <small>来自后端 RenderPlan，不是浏览器录屏画面</small>
      </header>
      {url ? (
        <img src={url} alt="当前导出设置生成的精确首帧" />
      ) : frame.isLoading ? (
        <p>
          <LoaderCircle className="spinning" aria-hidden /> 正在合成精确帧…
        </p>
      ) : (
        <p>{frame.error?.message || "精确帧暂时不可用"}</p>
      )}
    </section>
  );
}
