import { integrationKeys } from "./queryKeys";
import { useIntegrationInteraction, useIntegrationOpen } from "./interaction";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileArchive,
  Layers3,
  Plus,
  Search,
  Trash2,
  Tags,
} from "lucide-react";
import {
  addSkillVersion,
  createSkill,
  deleteSkill,
  downloadSkillVersion,
  getSkills,
  getSkillVersions,
  updateSkill,
  type Skill,
} from "@features/integrations/api";
import {
  IntegrationModal,
  PanelMessage,
  StatusBadge,
  ToggleButton,
} from "@features/integrations/components";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ApiError } from "@platform/api/client";

import {
  SkillTagField,
  SkillTagDialog,
} from "@features/integrations/SkillTags";
import { SkillVersionBrowser } from "@features/integrations/SkillVersionBrowser";
import "@features/integrations/skill-tags.css";
import { parseSkillTags } from "@features/integrations/skillTagValues";

const KEY = integrationKeys.catalog("skills");

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict") {
    return "Skill 已被其他操作更新，当前输入已保留，请关闭后重新打开最新版本再合并修改。";
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function UploadDialog({
  title,
  pending,
  onClose,
  onUpload,
  showEnabled,
  error,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  onUpload: (file: File, enabled: boolean, tags: string[]) => void;
  showEnabled: boolean;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [tagsText, setTagsText] = useState("");
  const tags = parseSkillTags(tagsText);
  return (
    <IntegrationModal title={title} onClose={onClose} protect pending={pending}>
      <div className="integration-form">
        {error && <p role="alert">{error}</p>}
        <div className="skill-drop">
          <FileArchive aria-hidden />
          <strong>{file?.name ?? "选择 Skill ZIP 包"}</strong>
          <small>最多 10 MiB，必须包含根 SKILL.md</small>
          <button
            type="button"
            className="btn"
            onClick={() => input.current?.click()}
          >
            选择文件
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {showEnabled ? (
          <SkillTagField value={tagsText} onChange={setTagsText} />
        ) : null}
        {showEnabled ? (
          <ToggleButton
            value={enabled}
            onChange={setEnabled}
            label="导入后启用"
          />
        ) : null}
        <footer className="integration-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!file || pending || tags.length > 12}
            onClick={() => file && onUpload(file, enabled, tags)}
          >
            {pending ? "校验并导入中…" : "上传并校验"}
          </button>
        </footer>
      </div>
    </IntegrationModal>
  );
}

export function SkillPanel({
  canManage,
  search,
  status,
  onSearchChange,
  onStatusChange,
}: {
  canManage: boolean;
  search: string;
  status: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const { blocked } = useIntegrationInteraction();
  const query = useQuery({ queryKey: KEY, queryFn: getSkills });
  const [uploading, setUploading] = useState(false);
  const [addingTo, setAddingTo] = useState<Skill | null>(null);
  const [viewing, setViewing] = useState<Skill | null>(null);
  const [details, setDetails] = useState<Skill | null>(null);
  const [detailVersion, setDetailVersion] = useState("");
  const detailVersionsQuery = useQuery({
    queryKey: integrationKeys.versions(details?.id ?? ""),
    queryFn: () => getSkillVersions(details!),
    enabled: Boolean(details),
  });
  const versionsQuery = useQuery({
    queryKey: integrationKeys.versions(viewing?.id ?? ""),
    queryFn: () => getSkillVersions(viewing!),
    enabled: Boolean(viewing),
  });
  const versions = versionsQuery.data ?? [];
  const [selectedVersion, setSelectedVersion] = useState("");
  const [removing, setRemoving] = useState<Skill | null>(null);
  const [notice, setNotice] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [editingTags, setEditingTags] = useState<Skill | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: ({
      file,
      enabled,
      tags,
    }: {
      file: File;
      enabled: boolean;
      tags: string[];
    }) => createSkill(file, enabled, tags),
    onSuccess: (skill) => {
      setUploading(false);
      setNotice(`${skill.name} 已通过校验并导入。`);
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        void refresh();
      }
    },
  });
  const add = useMutation({
    mutationFn: ({ skill, file }: { skill: Skill; file: File }) =>
      addSkillVersion(skill, file),
    onSuccess: (skill) => {
      setAddingTo(null);
      setNotice(`${skill.name} ${skill.latest_version} 已导入。`);
      void refresh();
      void openVersions(skill);
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        void refresh();
      }
    },
  });
  const update = useMutation({
    mutationFn: ({
      skill,
      enabled,
      version,
    }: {
      skill: Skill;
      enabled: boolean;
      version: string;
    }) => updateSkill(skill, enabled, version),
    onSuccess: (skill) => {
      setViewing(skill);
      setSelectedVersion(skill.default_version);
      setNotice("Skill 设置已更新。");
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        void refresh();
      }
    },
  });
  const editTags = useMutation({
    mutationFn: ({ skill, tags }: { skill: Skill; tags: string[] }) =>
      updateSkill(skill, skill.enabled, skill.default_version, tags),
    onSuccess: () => {
      setEditingTags(null);
      setNotice("Skill 标签已更新。");
      void refresh();
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        setNotice(errorMessage(error));
        void refresh();
      }
    },
  });
  const tagOptions = [
    ...new Set((query.data?.items ?? []).flatMap((skill) => skill.tags)),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const activeTagFilter =
    tagFilter.startsWith("tag:") && !tagOptions.includes(tagFilter.slice(4))
      ? "all"
      : tagFilter;
  const remove = useMutation({
    mutationFn: deleteSkill,
    onSuccess: () => {
      setRemoving(null);
      setViewing(null);
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      )
        void refresh();
    },
  });
  const items = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) =>
          `${item.name} ${item.description} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (status === "all" ||
            (status === "enabled" ? item.enabled : !item.enabled)) &&
          (activeTagFilter === "all" ||
            (activeTagFilter === "untagged"
              ? item.tags.length === 0
              : item.tags.includes(activeTagFilter.slice(4)))),
      ),
    [query.data, search, status, activeTagFilter],
  );
  useEffect(() => {
    if (!query.data || blocked()) return;
    setDetails((current) =>
      current
        ? (query.data.items.find((item) => item.id === current.id) ?? null)
        : null,
    );
    setViewing((current) =>
      current
        ? (query.data.items.find((item) => item.id === current.id) ?? null)
        : null,
    );
  }, [query.data, blocked]);
  useIntegrationOpen("skill", !query.isPending, async (request, active) => {
    const catalog = await client.fetchQuery({
      queryKey: integrationKeys.catalog("skills"),
      queryFn: getSkills,
      staleTime: 0,
    });
    if (!active()) return;
    setDetails(null);
    setViewing(null);
    setEditingTags(null);
    setUploading(false);
    if (request.view === "list") return;
    if (request.view === "upload") {
      if (!canManage) throw new Error("权限不足");
      setUploading(true);
      return;
    }
    const item = catalog.items.find((item) => item.id === request.resource_id);
    if (!item) throw new Error("Skill 不存在");
    if (request.view === "details") openDetails(item);
    else if (request.view === "versions") {
      await client.fetchQuery({
        queryKey: integrationKeys.versions(item.id),
        queryFn: () => getSkillVersions(item),
      });
      if (!active()) return;
      setViewing(item);
      setSelectedVersion(item.default_version);
    } else if (request.view === "tags") {
      if (!canManage) throw new Error("权限不足");
      setEditingTags(item);
    }
  });
  const openVersions = async (skill: Skill) => {
    setViewing(skill);
    setSelectedVersion(skill.default_version);
    try {
      await client.fetchQuery({
        queryKey: integrationKeys.versions(skill.id),
        queryFn: () => getSkillVersions(skill),
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const openDetails = (skill: Skill) => {
    setDetails(skill);
    setDetailVersion(skill.default_version);
  };
  const download = async (skill: Skill, version: string) => {
    try {
      saveBlob(
        await downloadSkillVersion(skill, version),
        `${skill.name}-${version}.zip`,
      );
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  return (
    <div className="integration-panel">
      <div className="integration-toolbar skill-toolbar">
        <label className="integration-search">
          <Search aria-hidden />
          <input
            aria-label="搜索 Skill"
            placeholder="搜索 Skill 名称、说明或标签"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
        <CustomSelect
          ariaLabel="Skill 状态筛选"
          value={status}
          options={[
            { value: "all", label: "全部状态" },
            { value: "enabled", label: "已启用" },
            { value: "draft", label: "草稿" },
          ]}
          onChange={onStatusChange}
        />
        <CustomSelect
          ariaLabel="Skill 标签筛选"
          value={activeTagFilter}
          options={[
            { value: "all", label: "全部标签" },
            { value: "untagged", label: "无标签" },
            ...tagOptions.map((tag) => ({ value: `tag:${tag}`, label: tag })),
          ]}
          onChange={setTagFilter}
        />
        {canManage ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setUploading(true)}
          >
            <Plus aria-hidden />
            上传 Skill
          </button>
        ) : null}
      </div>
      {notice ? <PanelMessage>{notice}</PanelMessage> : null}
      <div className="integration-layout">
        <main className="integration-grid">
          {query.isLoading ? (
            <PanelMessage>正在加载 Skill…</PanelMessage>
          ) : query.isError ? (
            <PanelMessage>加载失败，请重试。</PanelMessage>
          ) : items.length === 0 ? (
            <PanelMessage>
              {query.data?.items.length
                ? "没有匹配的 Skill。"
                : "还没有 Skill，上传 ZIP 后会先进行安全校验。"}
            </PanelMessage>
          ) : (
            items.map((item) => (
              <article className="integration-card skill-card" key={item.id}>
                <header>
                  <span className="integration-card-icon">
                    <FileArchive aria-hidden />
                  </span>
                  <StatusBadge enabled={item.enabled} status={item.status} />
                </header>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <button
                  type="button"
                  className="skill-details-trigger"
                  aria-label={`查看 ${item.name} 详情`}
                  onClick={() => openDetails(item)}
                >
                  查看详情
                </button>
                <div
                  className="skill-tags skill-card-tags"
                  aria-label={`${item.name} 标签`}
                >
                  {item.tags.length ? (
                    <>
                      {item.tags.slice(0, 2).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                      {item.tags.length > 2 ? (
                        <span
                          className="skill-tags-count"
                          aria-label={`另有 ${item.tags.length - 2} 个标签`}
                        >
                          +{item.tags.length - 2}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <small>无标签</small>
                  )}
                </div>
                <div className="integration-card-meta">
                  <code>{item.default_version}</code>
                  <span>{item.version_count} 个不可变版本</span>
                </div>
                <footer>
                  <span>最新 {item.latest_version}</span>
                  <span className="card-actions">
                    <button
                      aria-label={`查看 ${item.name} 版本`}
                      onClick={() => void openVersions(item)}
                    >
                      <Layers3 aria-hidden />
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={`编辑 ${item.name} 标签`}
                        onClick={() => {
                          editTags.reset();
                          setEditingTags(item);
                        }}
                      >
                        <Tags aria-hidden />
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        aria-label={`删除 ${item.name}`}
                        onClick={() => setRemoving(item)}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    ) : null}
                  </span>
                </footer>
              </article>
            ))
          )}
        </main>
        <aside className="integration-overview">
          <h2>Skill 概览</h2>
          <div className="overview-stats">
            <span>
              <strong>{query.data?.enabled_count ?? 0}</strong>已启用
            </span>
            <span>
              <strong>{query.data?.draft_count ?? 0}</strong>草稿
            </span>
            <span>
              <strong>{query.data?.version_count ?? 0}</strong>版本总数
            </span>
          </div>
          <div className="skill-safety-note">
            <FileArchive aria-hidden />
            <div>
              <h3>本地安全导入</h3>
              <p>
                ZIP 只会解压与校验，不会执行包内脚本。版本一经导入不可修改。
              </p>
            </div>
          </div>
        </aside>
      </div>
      {details ? (
        <IntegrationModal
          title="Skill 详情"
          onClose={() => setDetails(null)}
          wide
          className="skill-details-modal"
        >
          <div className="skill-details">
            <div className="skill-details-heading">
              <div>
                <h3>{details.name}</h3>
                <p>{details.description || "暂无说明"}</p>
              </div>
              {detailVersionsQuery.data &&
              detailVersionsQuery.data.length > 1 ? (
                <CustomSelect
                  className="skill-version-select"
                  ariaLabel="查看 Skill 版本"
                  value={detailVersion}
                  options={detailVersionsQuery.data.map((version) => ({
                    value: version.version,
                    label: version.version,
                  }))}
                  onChange={setDetailVersion}
                />
              ) : (
                <span className="skill-version-chip">{detailVersion}</span>
              )}
            </div>
            <div className="skill-tags" aria-label="全部标签">
              {details.tags.length ? (
                details.tags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <small>无标签</small>
              )}
            </div>
            {detailVersion ? (
              <SkillVersionBrowser
                skill={details}
                version={detailVersion}
                onDownload={() => void download(details, detailVersion)}
              />
            ) : null}
          </div>
        </IntegrationModal>
      ) : null}
      {uploading ? (
        <UploadDialog
          title="上传 Skill ZIP"
          error={create.isError ? errorMessage(create.error) : undefined}
          pending={create.isPending}
          onClose={() => setUploading(false)}
          showEnabled
          onUpload={(file, enabled, tags) =>
            create.mutate({ file, enabled, tags })
          }
        />
      ) : null}
      {addingTo ? (
        <UploadDialog
          title={`为 ${addingTo.name} 添加新版本`}
          error={add.isError ? errorMessage(add.error) : undefined}
          pending={add.isPending}
          onClose={() => setAddingTo(null)}
          showEnabled={false}
          onUpload={(file) => add.mutate({ skill: addingTo, file })}
        />
      ) : null}
      {viewing ? (
        <IntegrationModal
          title={`${viewing.name} · 版本`}
          resetKey={update.data?.revision}
          protect
          pending={update.isPending}
          onClose={() => setViewing(null)}
          wide
        >
          {update.isError && <p role="alert">{errorMessage(update.error)}</p>}
          <div className="skill-version-controls">
            <div>
              <strong>默认版本</strong>
              <CustomSelect
                ariaLabel="默认 Skill 版本"
                value={selectedVersion}
                options={versions.map((version) => ({
                  value: version.version,
                  label: version.version,
                }))}
                onChange={setSelectedVersion}
              />
            </div>
            {canManage ? (
              <>
                <ToggleButton
                  value={viewing.enabled}
                  onChange={(enabled) =>
                    update.mutate({
                      skill: viewing,
                      enabled,
                      version: selectedVersion,
                    })
                  }
                />
                <button
                  className="btn"
                  type="button"
                  disabled={
                    update.isPending ||
                    selectedVersion === viewing.default_version
                  }
                  onClick={() =>
                    update.mutate({
                      skill: viewing,
                      enabled: viewing.enabled,
                      version: selectedVersion,
                    })
                  }
                >
                  设为默认
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => setAddingTo(viewing)}
                >
                  <Plus aria-hidden />
                  添加版本
                </button>
              </>
            ) : null}
          </div>
          <div className="skill-version-list">
            {versions.map((version) => (
              <article key={version.id}>
                <span>
                  <strong>
                    {version.version}
                    {version.version === viewing.default_version
                      ? " · 默认"
                      : ""}
                  </strong>
                  <small>
                    {version.file_count} 个文件 ·{" "}
                    {(version.expanded_bytes / 1024).toFixed(1)} KiB · SHA-256{" "}
                    {version.content_sha256.slice(0, 12)}…
                  </small>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void download(viewing, version.version)}
                >
                  <Download aria-hidden />
                  下载 ZIP
                </button>
              </article>
            ))}
          </div>
        </IntegrationModal>
      ) : null}
      {editingTags ? (
        <SkillTagDialog
          key={editingTags.id}
          skill={editingTags}
          pending={editTags.isPending}
          error={editTags.isError ? errorMessage(editTags.error) : ""}
          onClose={() => setEditingTags(null)}
          onSave={(tags) => editTags.mutate({ skill: editingTags, tags })}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(removing)}
        title="删除 Skill？"
        description="所有本地版本将移入回收区，数据库记录和版本历史将被删除。"
        confirmLabel="删除"
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </div>
  );
}
