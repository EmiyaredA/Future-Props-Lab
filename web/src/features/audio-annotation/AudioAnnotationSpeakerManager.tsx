import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Users, X } from "lucide-react";
import {
  getGalgameStoryDocument,
  getGalgameWorkshopProjects,
  type GalgameWorkshopProject,
} from "@features/galgame-workshop";
import {
  SPEAKER_COLORS,
  type ImportedAudioAnnotationSpeaker,
} from "@features/audio-annotation/model";
import type { AudioAnnotationSpeaker } from "@features/audio-annotation/types";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";

const EMPTY_GALGAME_PROJECTS: GalgameWorkshopProject[] = [];

export function AudioAnnotationSpeakerManager({
  open,
  projectTitle,
  speakers,
  onChange,
  onImport,
  onDelete,
  onClose,
}: {
  open: boolean;
  projectTitle: string;
  speakers: AudioAnnotationSpeaker[];
  onChange: (speakers: AudioAnnotationSpeaker[]) => void;
  onImport: (speakers: ImportedAudioAnnotationSpeaker[]) => number;
  onDelete: (speaker: AudioAnnotationSpeaker) => void;
  onClose: () => void;
}) {
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["galgame-speaker-import-projects"],
    queryFn: getGalgameWorkshopProjects,
    enabled: open,
  });
  const projects = projectsQuery.data?.items ?? EMPTY_GALGAME_PROJECTS;
  const matchingProject = useMemo(() => {
    const normalizedTitle = projectTitle.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedTitle) return undefined;
    return projects.find((project) => {
      const title = project.title.trim().toLocaleLowerCase("zh-CN");
      return (
        title &&
        (normalizedTitle.includes(title) || title.includes(normalizedTitle))
      );
    });
  }, [projectTitle, projects]);

  useEffect(() => {
    if (!open) {
      setSourceProjectId("");
      setImportNotice("");
      return;
    }
    if (!sourceProjectId && projects.length)
      setSourceProjectId(matchingProject?.id ?? projects[0]!.id);
  }, [matchingProject, open, projects, sourceProjectId]);

  const storyQuery = useQuery({
    queryKey: ["galgame-speaker-import-story", sourceProjectId],
    queryFn: () => getGalgameStoryDocument(sourceProjectId),
    enabled: open && Boolean(sourceProjectId),
  });

  const importCharacters = () => {
    const characters = storyQuery.data?.document.characters ?? [];
    if (!characters.length) {
      setImportNotice("这个 Galgame 工程还没有角色。");
      return;
    }
    const addedCount = onImport(
      characters.map((character) => ({
        id: character.id,
        name: character.name,
        color: character.themeColor,
      })),
    );
    setImportNotice(
      addedCount
        ? `已加入 ${addedCount} 个角色名，重复名称会自动跳过。`
        : "没有新增角色名，现有名单已包含这些角色。",
    );
  };

  const add = () => {
    if (speakers.length >= 64) return;
    const used = new Set(
      speakers.map((speaker) => speaker.name.toLocaleLowerCase("zh-CN")),
    );
    let index = speakers.length + 1;
    while (used.has(`说话人 ${index}`.toLocaleLowerCase("zh-CN"))) index += 1;
    onChange([
      ...speakers,
      {
        id: crypto.randomUUID(),
        name: `说话人 ${index}`,
        color: SPEAKER_COLORS[speakers.length % SPEAKER_COLORS.length]!,
      },
    ]);
  };
  const rename = (speaker: AudioAnnotationSpeaker, name: string) => {
    const normalized = name.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return;
    if (
      speakers.some(
        (item) =>
          item.id !== speaker.id &&
          item.name.trim().toLocaleLowerCase("zh-CN") === normalized,
      )
    )
      return;
    onChange(
      speakers.map((item) =>
        item.id === speaker.id ? { ...item, name } : item,
      ),
    );
  };
  if (!open) return null;
  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal annotation-speaker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="管理说话人"
      >
        <header>
          <div>
            <span className="eyebrow">任务内名单</span>
            <h2>管理说话人</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <section className="annotation-speaker-import">
          <div>
            <strong>从 Galgame 工坊导入角色</strong>
            <small>沿用角色名和主题色，导入后仍可继续编辑。</small>
          </div>
          {projectsQuery.isLoading ? (
            <p>正在读取 Galgame 工程…</p>
          ) : projects.length ? (
            <div className="annotation-speaker-import-controls">
              <CustomSelect
                ariaLabel="角色来源工程"
                value={sourceProjectId}
                options={projects.map((project: GalgameWorkshopProject) => ({
                  value: project.id,
                  label: project.title,
                  description:
                    project.status === "completed" ? "已完成" : "草稿",
                }))}
                onChange={(value) => {
                  setSourceProjectId(value);
                  setImportNotice("");
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={storyQuery.isLoading || !storyQuery.data}
                onClick={importCharacters}
              >
                <Users aria-hidden />
                {storyQuery.isLoading ? "读取角色…" : "导入角色名"}
              </button>
            </div>
          ) : (
            <p>暂无可导入的 Galgame 工程。</p>
          )}
          {storyQuery.isError ? <p>角色读取失败，请稍后重试。</p> : null}
          {importNotice ? <small role="status">{importNotice}</small> : null}
        </section>
        <div className="annotation-speaker-list">
          {speakers.map((speaker, index) => (
            <div key={speaker.id}>
              <CustomColorPicker
                compact
                value={speaker.color}
                ariaLabel={`${speaker.name}颜色`}
                colors={SPEAKER_COLORS}
                onChange={(color) =>
                  onChange(
                    speakers.map((item) =>
                      item.id === speaker.id ? { ...item, color } : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`说话人 ${index + 1} 名称`}
                value={speaker.name}
                maxLength={80}
                onChange={(event) => rename(speaker, event.target.value)}
              />
              <button
                type="button"
                aria-label={`删除说话人${speaker.name}`}
                onClick={() => onDelete(speaker)}
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
          {!speakers.length ? (
            <p>还没有说话人。添加后即可分配给片段。</p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className="btn"
            disabled={speakers.length >= 64}
            onClick={add}
          >
            <Plus aria-hidden /> 添加说话人
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
