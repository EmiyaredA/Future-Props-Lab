import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Upload } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { ManagedFile } from "@features/files";
import { ProjectMediaSourceDialog } from "../generation/ProjectMediaSourceDialog";
import type { MaterialUploadDestination, VisualMaterialCategory } from "../api";

export function MaterialUpload({
  projectId,
  categories,
  destination,
  disabled,
  onChange,
  onUpload,
  onAddFiles,
}: {
  projectId: string;
  categories: VisualMaterialCategory[];
  destination: MaterialUploadDestination;
  disabled: boolean;
  onChange: (destination: MaterialUploadDestination) => void;
  onUpload: (files: File[], destination: MaterialUploadDestination) => void;
  onAddFiles: (
    files: ManagedFile[],
    destination: MaterialUploadDestination,
  ) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const closeSource = () => {
    setSourceOpen(false);
    requestAnimationFrame(() => sourceButton.current?.focus());
  };
  const category = categories.find(
    (item) => item.id === destination.category_id,
  );
  const invalid = Boolean(
    (destination.category_id && !category) ||
    (destination.group && !category?.groups?.includes(destination.group)),
  );
  return (
    <section className="board-material-upload" aria-label="上传位置">
      <span>上传到</span>
      <CustomSelect
        ariaLabel="上传分类"
        value={destination.category_id ?? ""}
        disabled={disabled}
        onChange={(value) =>
          onChange({ category_id: value || null, group: null })
        }
        options={[
          { value: "", label: "未分类" },
          ...categories.map((item) => ({ value: item.id, label: item.name })),
        ]}
      />
      <CustomSelect
        ariaLabel="上传分组"
        value={destination.group ?? ""}
        disabled={disabled || !category}
        onChange={(value) => onChange({ ...destination, group: value || null })}
        options={[
          { value: "", label: "未分组" },
          ...(category?.groups ?? []).map((group) => ({
            value: group,
            label: group,
          })),
        ]}
      />
      {invalid && <p role="alert">目标分类或分组已变更，请重新选择。</p>}
      <button
        className="board-upload"
        disabled={disabled || invalid}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} /> 选择文件
      </button>
      <button
        ref={sourceButton}
        type="button"
        className="board-upload"
        disabled={disabled || invalid}
        aria-haspopup="dialog"
        onClick={() => setSourceOpen(true)}
      >
        <FolderOpen size={14} /> 从应用选择
      </button>
      <input
        ref={input}
        hidden
        aria-label="上传项目素材文件"
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length && !disabled && !invalid)
            onUpload(files, destination);
        }}
      />
      {sourceOpen &&
        createPortal(
          <ProjectMediaSourceDialog
            mode="board"
            projectId={projectId}
            multiple
            limit={50}
            onClose={closeSource}
            onConfirm={async (_ids, files) => {
              if (disabled || invalid)
                throw new Error("当前无法添加素材，请检查上传位置和项目状态。");
              await onAddFiles(files, destination);
              closeSource();
            }}
          />,
          document.body,
        )}
    </section>
  );
}
