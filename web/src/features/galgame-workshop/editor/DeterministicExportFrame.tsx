import { LoadingScene } from "@shared/ui/LoadingScene";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, RefreshCcw } from "lucide-react";
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
    queryKey: ["galgame-video-export-frame", projectId, fingerprint, request],
    queryFn: () =>
      previewGalgameVideoExportFrame(projectId, {
        ...request,
        timeMs: 0,
        width: 960,
      }),
    enabled: false,
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
        <span>
          <strong>确定性导出首帧</strong>
          <small>按需生成，避免打开窗口时占用渲染资源</small>
        </span>
        <button
          type="button"
          disabled={frame.isFetching}
          onClick={() => void frame.refetch()}
        >
          {url ? <RefreshCcw aria-hidden /> : <Image aria-hidden />}
          {url ? "重新生成" : "生成精确首帧"}
        </button>
      </header>
      {frame.isFetching ? (
        <p>
          <LoadingScene /> 正在合成精确帧…
        </p>
      ) : url ? (
        <ResponsiveImage src={url} alt="当前导出设置生成的精确首帧" />
      ) : frame.isError ? (
        <p>{frame.error.message || "精确帧暂时不可用"}</p>
      ) : (
        <p>需要核对最终合成效果时再生成，不影响直接开始导出。</p>
      )}
    </section>
  );
}
