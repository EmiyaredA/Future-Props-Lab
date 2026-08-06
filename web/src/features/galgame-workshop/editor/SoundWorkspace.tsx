import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  ChevronRight,
  FolderOpen,
  Music2,
  Plus,
  Search,
  Trash2,
  Upload,
  Volume2,
  Waves,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  deleteGalgameProjectAsset,
  getGalgameProjectAssets,
  uploadGalgameProjectAsset,
  type GalgameStoryAudioAsset,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  AUDIO_ROLE_LABELS,
  audioReferences,
  stableId,
  type AudioRole,
} from "@features/galgame-workshop/editor/model";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

const AUDIO_ROLES = Object.keys(AUDIO_ROLE_LABELS) as AudioRole[];

function displayLabel(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || "未命名声音";
}

export function SoundWorkspace({
  projectId,
  document,
  onDocument,
  onCommitDocument,
  onLocate,
  onCharacter,
  onNotice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onLocate: (fragmentId: string, blockId: string) => void;
  onCharacter: (characterId: string) => void;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const assets = useMemo(
    () =>
      (document.assets ?? []).filter(
        (asset): asset is GalgameStoryAudioAsset => asset.type === "audio",
      ),
    [document.assets],
  );
  const [role, setRole] = useState<AudioRole | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    assets[0]?.id,
  );
  const [pendingRole, setPendingRole] = useState<AudioRole>("backgroundMusic");
  const [pickerSource, setPickerSource] =
    useState<StoryAudioPickerSource>("project");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const projectFilesQuery = useQuery({
    queryKey: ["galgame-project-assets", projectId, ""],
    queryFn: () => getGalgameProjectAssets(projectId),
  });
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const references = selected ? audioReferences(document, selected.id) : [];
  const visible = assets.filter(
    (asset) =>
      (role === "all" || asset.role === role) &&
      asset.label
        .toLocaleLowerCase("zh-CN")
        .includes(query.toLocaleLowerCase("zh-CN")),
  );
  const usedFileIds = new Set(
    (document.assets ?? []).map((asset) => asset.fileId),
  );

  useEffect(() => {
    if (!selected && assets[0]) setSelectedId(assets[0].id);
  }, [assets, selected]);

  const bindFile = (fileId: string, name: string) => {
    const existing = assets.find(
      (asset) => asset.fileId === fileId && asset.role === pendingRole,
    );
    if (existing) {
      setSelectedId(existing.id);
      setPickerOpen(false);
      return;
    }
    const asset: GalgameStoryAudioAsset = {
      id: stableId(),
      type: "audio",
      role: pendingRole,
      label: displayLabel(name),
      fileId,
      status: "ready",
    };
    onDocument({ ...document, assets: [...(document.assets ?? []), asset] });
    setSelectedId(asset.id);
    setRole(pendingRole);
    setPickerOpen(false);
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "声音上传失败"),
  });

  const chooseRoleAndOpen = (nextRole: AudioRole) => {
    setPendingRole(nextRole);
    setPickerSource("project");
    setPickerOpen(true);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (references.length) {
      onNotice(`无法删除：声音仍被 ${references.length} 处内容引用。`);
      return;
    }
    const next = {
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) => asset.id !== selected.id,
      ),
    };
    setBusyDelete(true);
    const saved = await onCommitDocument(next);
    if (!saved) {
      setBusyDelete(false);
      return;
    }
    const projectFile = (projectFilesQuery.data?.items ?? []).find(
      (asset) => asset.id === selected.fileId,
    );
    if (projectFile) {
      try {
        await deleteGalgameProjectAsset(projectId, projectFile);
        await client.invalidateQueries({
          queryKey: ["galgame-project-assets", projectId],
        });
      } catch (caught) {
        onNotice(
          caught instanceof Error
            ? `故事引用已移除，但文件删除失败：${caught.message}`
            : "故事引用已移除，但文件删除失败。",
        );
      }
    }
    setSelectedId(assets.find((asset) => asset.id !== selected.id)?.id);
    setBusyDelete(false);
  };

  return (
    <section className="galgame-sound-workspace">
      <aside className="galgame-sound-categories">
        <header>
          <span>
            <small>AUDIO</small>
            <strong>声音资源</strong>
          </span>
          <button
            type="button"
            aria-label="添加声音"
            onClick={() => chooseRoleAndOpen("backgroundMusic")}
          >
            <Plus aria-hidden />
          </button>
        </header>
        <div className="galgame-sound-role-list">
          <button
            type="button"
            className={role === "all" ? "active" : ""}
            onClick={() => setRole("all")}
          >
            <span>
              <AudioLines aria-hidden /> 全部声音
            </span>
            <em>{assets.length}</em>
          </button>
          {AUDIO_ROLES.map((item) => (
            <button
              key={item}
              type="button"
              className={role === item ? "active" : ""}
              onClick={() => setRole(item)}
            >
              <span>
                {item === "ambientSound" ? (
                  <Waves aria-hidden />
                ) : item === "soundEffect" ? (
                  <Volume2 aria-hidden />
                ) : (
                  <Music2 aria-hidden />
                )}
                {AUDIO_ROLE_LABELS[item]}
              </span>
              <em>{assets.filter((asset) => asset.role === item).length}</em>
            </button>
          ))}
        </div>
        <div className="galgame-sound-mix-summary">
          <strong>项目混音概况</strong>
          <small>4 个独立通道</small>
          <span>{assets.length} 个声音可用</span>
          <div aria-hidden>
            {Array.from({ length: 10 }, (_, index) => (
              <i
                key={index}
                style={{ height: `${9 + ((index * 13) % 22)}px` }}
              />
            ))}
          </div>
        </div>
        <footer>工程声音 · 通过 Story CAS 保存引用</footer>
      </aside>

      <main className="galgame-sound-library">
        <header>
          <span>
            <strong>
              {role === "all" ? "全部声音" : AUDIO_ROLE_LABELS[role]}
            </strong>
            <small>按最近添加排序</small>
          </span>
          <label>
            <Search aria-hidden />
            <input
              aria-label="搜索工程声音"
              value={query}
              placeholder="搜索名称…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => chooseRoleAndOpen(pendingRole)}>
            <FolderOpen aria-hidden /> 从文件库添加
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden /> 上传声音
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </header>
        <div className="galgame-sound-list">
          {visible.map((asset) => {
            const usage = audioReferences(document, asset.id).length;
            return (
              <article
                key={asset.id}
                className={asset.id === selected?.id ? "selected" : ""}
              >
                <StoryAudioPreview
                  fileId={asset.fileId}
                  label={asset.label}
                  compact
                />
                <button
                  type="button"
                  aria-label={`选择声音 ${asset.label}`}
                  onClick={() => setSelectedId(asset.id)}
                >
                  <em>{AUDIO_ROLE_LABELS[asset.role]}</em>
                  <small>{usage ? `使用 ${usage} 次` : "未使用"}</small>
                </button>
              </article>
            );
          })}
          {!visible.length ? (
            <div className="galgame-sound-empty">
              <Music2 aria-hidden />
              <strong>还没有这类声音</strong>
              <span>上传文件或从全局文件库复用音频。</span>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="galgame-sound-inspector">
        <nav>
          <button type="button" className="active">
            属性
          </button>
          <button type="button">使用位置</button>
        </nav>
        {selected ? (
          <div>
            <header>
              <span>
                <Music2 aria-hidden />
              </span>
              <span>
                <small>{AUDIO_ROLE_LABELS[selected.role]}</small>
                <strong>{selected.label}</strong>
              </span>
            </header>
            <StoryAudioPreview
              fileId={selected.fileId}
              label={selected.label}
            />
            <label className="galgame-field">
              <span>显示名称</span>
              <input
                value={selected.label}
                onChange={(event) =>
                  onDocument({
                    ...document,
                    assets: (document.assets ?? []).map((asset) =>
                      asset.id === selected.id && asset.type === "audio"
                        ? { ...asset, label: event.target.value }
                        : asset,
                    ),
                  })
                }
              />
            </label>
            <label className="galgame-field">
              <span>声音类型</span>
              <CustomSelect
                ariaLabel="声音类型"
                value={selected.role}
                disabled={references.length > 0}
                options={AUDIO_ROLES.map((item) => ({
                  value: item,
                  label: AUDIO_ROLE_LABELS[item],
                }))}
                onChange={(nextRole) =>
                  onDocument({
                    ...document,
                    assets: (document.assets ?? []).map((asset) =>
                      asset.id === selected.id && asset.type === "audio"
                        ? { ...asset, role: nextRole as AudioRole }
                        : asset,
                    ),
                  })
                }
              />
            </label>
            <section className="galgame-sound-references">
              <strong>使用位置</strong>
              {references.map((reference) => (
                <button
                  key={`${reference.kind}-${reference.blockId ?? reference.characterId ?? reference.fragmentId}`}
                  type="button"
                  onClick={() => {
                    if (reference.characterId)
                      onCharacter(reference.characterId);
                    if (reference.fragmentId && reference.blockId)
                      onLocate(reference.fragmentId, reference.blockId);
                  }}
                >
                  <span>{reference.label}</span>
                  <ChevronRight aria-hidden />
                </button>
              ))}
              {!references.length ? <small>尚未在故事中使用</small> : null}
            </section>
          </div>
        ) : (
          <div className="galgame-sound-inspector-empty">
            <Music2 aria-hidden />
            <strong>未选择声音</strong>
          </div>
        )}
        {selected ? (
          <footer>
            <button
              type="button"
              className="danger"
              disabled={busyDelete || references.length > 0}
              onClick={() => void deleteSelected()}
            >
              <Trash2 aria-hidden /> 删除声音
            </button>
          </footer>
        ) : null}
      </aside>

      {pickerOpen ? (
        <StoryAudioPicker
          projectId={projectId}
          title={`添加${AUDIO_ROLE_LABELS[pendingRole]}`}
          source={pickerSource}
          usedFileIds={usedFileIds}
          onSource={setPickerSource}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
