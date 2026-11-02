import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  AudioLines,
  FileText,
  Image,
  LoaderCircle,
  Upload,
  Video,
} from "lucide-react";
import { getFiles, uploadManagedFile, type MediaKind } from "@features/files";
import { fileQueryKeys, invalidateFileScope } from "@features/files";
import "./home-files.css";
import { ACCEPT, AssetPreview } from "@features/files";

const categories: {
  kind: MediaKind;
  title: string;
  hint: string;
  icon: typeof Image;
}[] = [
  { kind: "image", title: "图片素材", hint: "灵感、参考与画面", icon: Image },
  { kind: "video", title: "视频素材", hint: "镜头、片段与成片", icon: Video },
  {
    kind: "audio",
    title: "音频素材",
    hint: "声音、配乐与录音",
    icon: AudioLines,
  },
  {
    kind: "document",
    title: "文档资料",
    hint: "笔记、文稿与附件",
    icon: FileText,
  },
];

export function HomeFiles({
  onNavigate,
  canWrite,
}: {
  onNavigate: (path: string) => void;
  canWrite: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const files = useQuery({
    queryKey: fileQueryKeys.list({ includeReferences: true }),
    queryFn: () => getFiles({ includeReferences: true }),
  });
  const [failed, setFailed] = useState<File[]>([]);
  const [feedback, setFeedback] = useState("");
  const [progress, setProgress] = useState("");
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const retry: File[] = [];
      for (const [index, file] of selected.entries()) {
        setProgress(`正在上传 ${index + 1}/${selected.length}：${file.name}`);
        try {
          await uploadManagedFile(file);
        } catch {
          retry.push(file);
        }
      }
      return { retry, completed: selected.length - retry.length };
    },
    onSuccess: async ({ retry, completed }) => {
      setFailed(retry);
      setProgress("");
      setFeedback(
        retry.length
          ? `${completed} 个文件已上传，${retry.length} 个失败。可以重试。`
          : `${completed} 个文件已上传到文件库。`,
      );
      await invalidateFileScope(client);
    },
  });
  return (
    <>
      <div className="home-files-toolbar">
        <span>按类型浏览你的素材</span>
        {canWrite ? (
          <>
            <input
              hidden
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              aria-label="选择上传文件"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (selected.length) {
                  setFailed([]);
                  setFeedback("");
                  upload.mutate(selected);
                }
              }}
            />
            <button
              className="home-upload"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {upload.isPending ? (
                <LoaderCircle className="spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {upload.isPending ? "正在上传…" : "上传文件"}
            </button>
          </>
        ) : (
          <span>只读浏览</span>
        )}
      </div>
      {(progress || feedback) && (
        <div className="home-file-feedback" role="status">
          {progress || feedback}
          {failed.length > 0 && canWrite && (
            <button
              disabled={upload.isPending}
              onClick={() => upload.mutate(failed)}
            >
              重试失败文件
            </button>
          )}
        </div>
      )}
      {files.isError && (
        <div className="home-file-feedback" role="alert">
          暂时无法加载文件。
          <button onClick={() => void files.refetch()}>重新加载</button>
        </div>
      )}
      <div className="home-file-grid" aria-busy={files.isLoading}>
        {categories.map(({ kind, title, hint, icon: Icon }) => {
          const recent = files.data?.items.find(
            (file) => file.media_kind === kind,
          );
          return (
            <button
              className="home-file-category"
              key={kind}
              onClick={() => onNavigate(`/files?kind=${kind}`)}
            >
              <strong>
                <span className="home-copper-icon">
                  <Icon aria-hidden />
                </span>
                {title}
                <ArrowUpRight aria-hidden />
              </strong>
              <div className={`home-file-art home-file-art-${kind}`}>
                {recent ? <AssetPreview file={recent} /> : <Icon aria-hidden />}
              </div>
              <small>
                {files.isLoading
                  ? "正在加载…"
                  : (recent?.display_name ??
                    (files.isError ? "进入文件库查看" : hint))}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}
