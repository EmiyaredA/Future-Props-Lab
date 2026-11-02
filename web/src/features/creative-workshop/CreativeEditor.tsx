import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useEffect, useState } from "react";
import {
  getCreative,
  getCreativeRelease,
  listCreative,
  publishCreative,
  updateCreative,
  uploadCreative,
  withdrawCreative,
  type CreativeDraft,
  type CreativeItem,
  type CreativeRelease,
} from "./api";
import { errorText, labels, presets, type Nav } from "./shared";
import { Cover } from "./Cover";

export function Editor({
  itemId,
  canWrite,
  navigate,
}: {
  itemId?: string;
  canWrite: boolean;
  navigate: Nav;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [item, setItem] = useState<CreativeItem | null>(null);
  const [draft, setDraft] = useState<CreativeDraft | null>(null);
  const [view, setView] = useState<"edit" | "select" | "preview" | "success">(
    "edit",
  );
  const [candidates, setCandidates] = useState<CreativeItem[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CreativeRelease[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!itemId) return;
    let active = true;
    getCreative(itemId, true)
      .then((value) => {
        if (active) {
          setItem(value);
          setDraft({
            kind: value.kind,
            title: value.title,
            summary: value.summary,
            description: value.description,
            tags: value.tags,
            cover_preset: value.cover_preset,
            manifest: value.manifest,
            components: value.components,
          });
        }
      })
      .catch((cause) => active && setError(errorText(cause)));
    return () => {
      active = false;
    };
  }, [itemId]);
  useEffect(() => {
    if (view !== "select") return;
    let active = true;
    listCreative({ kind: filter, q: search })
      .then(
        (result) =>
          active &&
          setCandidates(
            result.items.filter((candidate) => candidate.kind !== "bundle"),
          ),
      )
      .catch((cause) => active && setError(errorText(cause)));
    return () => {
      active = false;
    };
  }, [view, filter, search]);
  const componentIds = draft?.components;
  useEffect(() => {
    if (!componentIds?.length) {
      setSelected([]);
      return;
    }
    let active = true;
    Promise.all(componentIds.map(getCreativeRelease))
      .then((releases) => active && setSelected(releases))
      .catch((cause) => active && setError(errorText(cause)));
    return () => {
      active = false;
    };
  }, [componentIds]);
  const change = (patch: Partial<CreativeDraft>) =>
    setDraft((old) => (old ? { ...old, ...patch } : old));
  const manifest = (patch: Record<string, unknown>) =>
    change({ manifest: { ...draft?.manifest, ...patch } });
  const save = async () => {
    if (!item || !draft) throw new Error("草稿尚未加载");
    const saved = await updateCreative(item.id, draft, item.revision);
    setItem(saved);
    return saved;
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!item || !draft)
    return (
      <p className="creative-empty">
        <TransferFeedback progress={activeTransferProgress} />
        {error || "正在加载草稿…"}
      </p>
    );
  if (!canWrite)
    return (
      <p className="creative-empty">
        <TransferFeedback progress={activeTransferProgress} />
        当前账号没有内容编辑权限。
      </p>
    );
  return (
    <>
      <TransferFeedback progress={activeTransferProgress} />

      <div className="creative-section-heading">
        <div>
          <div className="creative-breadcrumb">
            我的创作 / {labels[item.kind]}
          </div>
          <h2>
            {view === "success"
              ? "发布成功"
              : view === "select"
                ? "选择公开能力"
                : view === "preview"
                  ? "预览并发布"
                  : item.status === "published"
                    ? "编辑新版本"
                    : "编辑创作"}
          </h2>
          <p>
            {view === "success"
              ? "作品已经出现在创意广场。"
              : "先保存草稿，确认公开内容后即可发布。"}
          </p>
        </div>
        <button
          className="creative-text-button"
          onClick={() => navigate("creative-workshop-mine")}
        >
          ← 我的创作
        </button>
      </div>
      {view === "success" ? (
        <div className="creative-success">
          <div>✓</div>
          <h3>{item.title} 已发布</h3>
          <p>当前版本 v{item.version}，其他工作区现在可以浏览和安装。</p>
          <button
            className="creative-primary"
            onClick={() => navigate("creative-workshop-detail", item.id)}
          >
            查看作品
          </button>
          <button
            className="creative-secondary"
            onClick={() => navigate("creative-workshop")}
          >
            返回广场
          </button>
        </div>
      ) : null}
      {view === "edit" && (
        <div className="creative-editor-grid">
          <div className="creative-form-panel">
            <div className="creative-step">01 / 基本信息</div>
            <label>
              名称
              <input
                value={draft.title}
                maxLength={120}
                onChange={(event) => change({ title: event.target.value })}
                placeholder="给创作起一个清晰的名字"
              />
            </label>
            <label>
              一句话简介
              <textarea
                rows={2}
                maxLength={500}
                value={draft.summary}
                onChange={(event) => change({ summary: event.target.value })}
                placeholder="说明它能解决什么问题"
              />
            </label>
            <label>
              使用说明与建议步骤
              <textarea
                rows={7}
                maxLength={10000}
                value={draft.description}
                onChange={(event) =>
                  change({ description: event.target.value })
                }
                placeholder="描述适用场景、配置方法和使用步骤"
              />
            </label>
            <label>
              标签（用逗号分隔）
              <input
                value={draft.tags.join(", ")}
                onChange={(event) =>
                  change({
                    tags: event.target.value
                      .split(/[,，]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <div className="creative-step">02 / 封面</div>
            <div className="creative-presets">
              {presets.map((preset) => (
                <button
                  key={preset}
                  className={`creative-preset creative-cover--${preset}${draft.cover_preset === preset ? " active" : ""}`}
                  aria-label={`${preset} 预设封面`}
                  onClick={() => change({ cover_preset: preset })}
                >
                  ✦
                </button>
              ))}
            </div>
            <label className="creative-upload">
              上传自定义封面（PNG、JPEG、WebP）
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void run(async () => {
                      const saved = await save();
                      setItem(
                        await runTransfer((onProgress) =>
                          uploadCreative(
                            saved.id,
                            saved.revision,
                            file,
                            "cover",
                            { onProgress },
                          ),
                        ),
                      );
                    });
                }}
              />
            </label>
            {draft.kind === "tool_api" && (
              <>
                <div className="creative-step">03 / 工具 API 配置</div>
                <div className="creative-inline">
                  <label>
                    方法
                    <select
                      value={String(draft.manifest.method || "GET")}
                      onChange={(event) =>
                        manifest({ method: event.target.value })
                      }
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    鉴权方式
                    <select
                      value={String(draft.manifest.auth_kind || "none")}
                      onChange={(event) =>
                        manifest({ auth_kind: event.target.value })
                      }
                    >
                      <option value="none">无</option>
                      <option value="bearer">Bearer（安装后配置）</option>
                      <option value="api_key">API Key（安装后配置）</option>
                    </select>
                  </label>
                </div>
                <label>
                  URL
                  <input
                    value={String(draft.manifest.url || "")}
                    onChange={(event) => manifest({ url: event.target.value })}
                    placeholder="https://api.example.com/v1/action"
                  />
                </label>
                {draft.manifest.auth_kind === "api_key" && (
                  <label>
                    鉴权 Header 名称
                    <input
                      value={String(draft.manifest.auth_header_name || "")}
                      onChange={(event) =>
                        manifest({ auth_header_name: event.target.value })
                      }
                      placeholder="X-API-Key"
                    />
                  </label>
                )}
                <p className="creative-hint">
                  公开配置不能包含密钥、URL 查询参数或凭据。
                </p>
              </>
            )}
            {draft.kind === "mcp" && (
              <>
                <div className="creative-step">03 / MCP 配置</div>
                <label>
                  连接类型
                  <select
                    value={String(
                      draft.manifest.transport || "streamable_http",
                    )}
                    onChange={(event) =>
                      change({ manifest: { transport: event.target.value } })
                    }
                  >
                    <option value="streamable_http">HTTP MCP</option>
                    <option value="stdio">stdio MCP</option>
                  </select>
                </label>
                {draft.manifest.transport === "stdio" ? (
                  <label>
                    安装提示
                    <input
                      value={String(draft.manifest.command_hint || "")}
                      onChange={(event) =>
                        manifest({ command_hint: event.target.value })
                      }
                      placeholder="例如：使用 npm 安装对应服务"
                    />
                  </label>
                ) : (
                  <label>
                    服务 URL
                    <input
                      value={String(draft.manifest.url || "")}
                      onChange={(event) =>
                        manifest({ url: event.target.value })
                      }
                      placeholder="https://mcp.example.com/mcp"
                    />
                  </label>
                )}
                <p className="creative-hint">
                  stdio 命令不会跨工作区复制；安装后由管理员在本机配置。
                </p>
              </>
            )}
            {draft.kind === "skill" && (
              <>
                <div className="creative-step">03 / Skill 文件</div>
                <label className="creative-upload">
                  上传 Skill ZIP
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const saved = await save();
                          const uploaded = await runTransfer((onProgress) =>
                            uploadCreative(
                              saved.id,
                              saved.revision,
                              file,
                              "skill-archive",
                              { onProgress },
                            ),
                          );
                          setItem(uploaded);
                          change({ manifest: uploaded.manifest });
                        });
                    }}
                  />
                </label>
                {draft.manifest.content_sha256 && (
                  <p className="creative-hint">
                    已校验 ZIP · {String(draft.manifest.file_count)} 个文件 ·
                    SHA256 {String(draft.manifest.content_sha256).slice(0, 12)}…
                  </p>
                )}
              </>
            )}
            {draft.kind === "bundle" && (
              <>
                <div className="creative-step">03 / 组合能力</div>
                <p className="creative-hint">
                  工具 API、MCP、Skill 每类都可以为 0，但合计至少选择 1
                  项。引用固定的公开版本。
                </p>
                <div className="creative-selected">
                  {selected.map((release) => (
                    <div key={release.id}>
                      <span>{labels[release.kind]}</span>
                      <strong>{release.title}</strong>
                      <small>
                        v{release.version} · {release.author_name}
                      </small>
                      <button
                        aria-label={`移除 ${release.title}`}
                        onClick={() =>
                          change({
                            components: draft.components.filter(
                              (id) => id !== release.id,
                            ),
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="creative-secondary"
                  onClick={() => setView("select")}
                >
                  ＋ 选择公开能力
                </button>
              </>
            )}
          </div>
          <aside className="creative-editor-aside">
            <Cover
              item={{
                kind: draft.kind,
                cover_preset: draft.cover_preset,
                cover_url: item.cover_url,
              }}
            />
            <h3>发布前提醒</h3>
            <p>
              作品会对本部署中所有登录用户可见。请检查名称、说明、链接和文件中没有敏感信息。
            </p>
            <p>安装到其他工作区时会复制一份独立配置，后续版本不会自动同步。</p>
            <div className="creative-editor-actions">
              <button
                disabled={busy}
                className="creative-secondary"
                onClick={() =>
                  void run(async () => {
                    await save();
                  })
                }
              >
                保存草稿
              </button>
              <button
                disabled={busy}
                className="creative-primary"
                onClick={() =>
                  void run(async () => {
                    await save();
                    setView("preview");
                  })
                }
              >
                预览与发布 →
              </button>
            </div>
            {item.status === "published" && (
              <button
                className="creative-danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await save();
                    setItem(await withdrawCreative(saved.id, saved.revision));
                  })
                }
              >
                撤回当前公开版本
              </button>
            )}
          </aside>
        </div>
      )}
      {view === "select" && (
        <>
          <div className="creative-toolbar">
            <label className="creative-search">
              <span>⌕</span>
              <input
                aria-label="搜索公开能力"
                value={search}
                placeholder="搜索公开能力"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="creative-filter">
              {[
                ["", "全部"],
                ["tool_api", "工具 API"],
                ["mcp", "MCP"],
                ["skill", "Skill"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="creative-pick-list">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                className={
                  draft.components.includes(candidate.current_release_id || "")
                    ? "selected"
                    : ""
                }
                onClick={() => {
                  const id = candidate.current_release_id;
                  if (id)
                    change({
                      components: draft.components.includes(id)
                        ? draft.components.filter((value) => value !== id)
                        : [...draft.components, id],
                    });
                }}
              >
                <span>
                  {draft.components.includes(candidate.current_release_id || "")
                    ? "✓"
                    : "＋"}
                </span>
                <div>
                  <strong>{candidate.title}</strong>
                  <p>{candidate.summary}</p>
                  <small>
                    {labels[candidate.kind]} · v{candidate.version} · 原作者{" "}
                    {candidate.author_name}
                  </small>
                </div>
              </button>
            ))}
          </div>
          <div className="creative-bottom-bar">
            <span>已选 {draft.components.length} 项</span>
            <button
              className="creative-primary"
              onClick={() => setView("edit")}
            >
              完成选择
            </button>
          </div>
        </>
      )}
      {view === "preview" && (
        <div className="creative-preview">
          <Cover
            item={{
              kind: draft.kind,
              cover_preset: draft.cover_preset,
              cover_url: item.cover_url,
            }}
          />
          <div className="creative-preview-body">
            <span className="creative-badge">{labels[draft.kind]}</span>
            <h3>{draft.title || "未命名创作"}</h3>
            <p>{draft.summary}</p>
            <pre>{draft.description || "尚未填写使用说明"}</pre>
            {draft.kind === "bundle" && (
              <div className="creative-selected">
                {selected.map((release) => (
                  <div key={release.id}>
                    <span>{labels[release.kind]}</span>
                    <strong>{release.title}</strong>
                    <small>
                      v{release.version} · 原作者 {release.author_name}
                    </small>
                  </div>
                ))}
              </div>
            )}
            <div className="creative-bottom-bar">
              <button
                className="creative-secondary"
                onClick={() => setView("edit")}
              >
                返回编辑
              </button>
              <button
                className="creative-secondary"
                onClick={() =>
                  void run(async () => {
                    await save();
                    setView("edit");
                  })
                }
              >
                保存草稿
              </button>
              <button
                disabled={busy}
                className="creative-primary"
                onClick={() =>
                  void run(async () => {
                    const published = await publishCreative(
                      item.id,
                      item.revision,
                    );
                    setItem(published);
                    setView("success");
                  })
                }
              >
                确认公开发布
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="creative-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
