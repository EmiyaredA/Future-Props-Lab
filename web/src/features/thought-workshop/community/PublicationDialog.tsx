import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useAccountId } from "@platform/auth/AccountAccess";
import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import type { Directory } from "../knowledgeApi";
import { thoughtKeys } from "../queryKeys";
import {
  getPublicationConfig,
  publishLibrary,
  getCommunityManagement,
  manageCommunityPublication,
  type ArticleSetting,
  type PublishInput,
} from "./api";
import { ArticlePermissionsForm } from "./ArticlePermissionsForm";
import "./community.css";
export function PublicationDialog({
  directory,
  publicationId,
  close,
  saved,
}: {
  directory: Directory;
  publicationId?: string;
  close: () => void;
  saved: (id: string) => void;
}) {
  const user = useAccountId() ?? "";
  const config = useQuery({
    queryKey: thoughtKeys.publicationConfig(
      user,
      `dialog/${publicationId ?? directory.knowledge_base.id}`,
    ),
    queryFn: () =>
      publicationId
        ? getCommunityManagement(publicationId).then((result) => result.config)
        : getPublicationConfig(directory.knowledge_base.id),
    retry: false,
  });
  const [draft, setDraft] = useState<PublishInput | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeArticle, setActiveArticle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = directory.knowledge_base;
  const defaultDraft: PublishInput = {
    expected_revision: config.data?.publication?.revision ?? 0,
    title: config.data?.publication?.title ?? base.title,
    description:
      config.data?.publication?.description ?? base.description ?? "",
    active: true,
    is_official: config.data?.publication?.is_official ?? false,
    read_only: config.data?.publication?.read_only ?? true,
    editable_platform_roles:
      config.data?.publication?.editable_platform_roles ?? [],
    articles:
      config.data?.articles.map((a) => ({
        note_id: a.note_id,
        expected_revision: a.revision,
        visibility: a.visibility,
        active: a.active,
        members: a.members.map((m) => ({ username: m.username, role: m.role })),
      })) ?? [],
  };
  const value = draft ?? defaultDraft;
  const docs = [
    { id: base.home_note_id, title: "知识库首页", is_home: true },
    ...directory.documents,
  ];
  const chosen = (id: string) =>
    value.articles.find((a) => a.note_id === id)?.active ?? false;
  const setting = (id: string): ArticleSetting =>
    value.articles.find((a) => a.note_id === id) ?? {
      note_id: id,
      expected_revision: 0,
      visibility: "public",
      active: false,
      members: [],
    };
  const update = (a: ArticleSetting) =>
    setDraft({
      ...value,
      articles: [
        ...value.articles.filter((item) => item.note_id !== a.note_id),
        a,
      ],
    });
  const publish = async (active: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await (publicationId
        ? manageCommunityPublication(publicationId, { ...value, active })
        : publishLibrary(base.id, { ...value, active }));
      if (result.publication) saved(result.publication.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open
      tone="primary"
      confirmDisabled={
        !config.isSuccess ||
        !value.title.trim() ||
        !value.articles.length ||
        (!config.data?.publication && !value.articles.some((a) => a.active))
      }
      title="发布到知识社区"
      confirmLabel={config.data?.publication ? "保存发布设置" : "发布选定文章"}
      pending={busy}
      onCancel={close}
      onConfirm={() => {
        if (!config.isSuccess || !value.articles.length) {
          setError("请选择至少一篇文章，并等待配置加载完成。");
          return;
        }
        void publish(true);
      }}
      description={
        <div className="community-dialog-body">
          {config.isPending && (
            <LoadingState label="正在加载发布配置…" variant="region" />
          )}
          {config.isError && (
            <p role="alert">
              {config.error.message}
              <button className="btn" onClick={() => void config.refetch()}>
                重试
              </button>
            </p>
          )}
          <label>
            社区名称
            <input
              aria-label="社区名称"
              value={value.title}
              maxLength={240}
              onChange={(e) => setDraft({ ...value, title: e.target.value })}
            />
          </label>
          <label>
            简介
            <textarea
              aria-label="社区简介"
              value={value.description ?? ""}
              maxLength={4000}
              onChange={(e) =>
                setDraft({ ...value, description: e.target.value })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="只读发布"
              checked={value.read_only ?? true}
              onChange={(e) =>
                setDraft({ ...value, read_only: e.target.checked })
              }
            />
            只读发布
          </label>
          <p>
            只读发布仍允许发布者、源知识库管理者及显式授权的账号编辑；其他成员只阅读。私人笔记的权限不受影响。
          </p>
          {config.data?.can_set_official && (
            <>
              <label>
                <input
                  type="checkbox"
                  aria-label="官方发布"
                  checked={value.is_official ?? false}
                  onChange={(e) =>
                    setDraft({
                      ...value,
                      is_official: e.target.checked,
                      editable_platform_roles:
                        e.target.checked &&
                        !value.editable_platform_roles?.length
                          ? ["admin", "admin"]
                          : value.editable_platform_roles,
                    })
                  }
                />
                官方发布
              </label>
              <fieldset>
                <legend>可编辑的平台角色</legend>
                {(
                  [
                    ["admin", "超级管理员"],
                    ["admin", "管理员"],
                    ["user", "普通用户"],
                  ] as const
                ).map(([role, label]) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      aria-label={`${label}可编辑`}
                      checked={
                        value.editable_platform_roles?.includes(role) ?? false
                      }
                      onChange={(e) =>
                        setDraft({
                          ...value,
                          editable_platform_roles: e.target.checked
                            ? [...(value.editable_platform_roles ?? []), role]
                            : value.editable_platform_roles?.filter(
                                (r) => r !== role,
                              ),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
                <p>角色授权只允许编辑已可访问的文章，不授予发布管理权限。</p>
              </fieldset>
            </>
          )}
          <p>
            发布同一份文档，保存后立即更新。仅选中的文章开放；正文中的文字、图形、附件和知识库封面也随之开放，旧版本不开放。
          </p>
          <div className="community-selection-bar">
            <strong>
              选择文章 · {docs.filter((d) => chosen(d.id)).length} 篇
            </strong>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                setDraft({
                  ...value,
                  articles: docs.map((d) => ({
                    ...setting(d.id),
                    active: true,
                  })),
                })
              }
            >
              全选
            </button>
          </div>
          <div className="community-publish-list">
            {docs.map((n) => (
              <div className="community-publish-row" key={n.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`发布 ${n.title}`}
                    checked={chosen(n.id)}
                    onChange={(e) =>
                      update({ ...setting(n.id), active: e.target.checked })
                    }
                  />
                  <span>
                    {n.is_home ? "首页 · " : ""}
                    {n.title}
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`批量设置 ${n.title}`}
                    checked={selected.includes(n.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, n.id]
                          : selected.filter((id) => id !== n.id),
                      )
                    }
                  />
                  批量
                </label>
                <button
                  className="btn"
                  onClick={() =>
                    setActiveArticle(activeArticle === n.id ? null : n.id)
                  }
                >
                  权限
                </button>
              </div>
            ))}
          </div>
          {activeArticle && (
            <section>
              <h3>
                {docs.find((d) => d.id === activeArticle)?.title} · 文章权限
              </h3>
              <ArticlePermissionsForm
                value={setting(activeArticle)}
                onChange={update}
              />
              {selected.length > 0 && (
                <button
                  className="btn"
                  onClick={() => {
                    const a = setting(activeArticle);
                    setDraft({
                      ...value,
                      articles: [
                        ...value.articles.filter(
                          (item) => !selected.includes(item.note_id),
                        ),
                        ...selected.map((id) => ({
                          ...setting(id),
                          visibility: a.visibility,
                          members: a.members,
                        })),
                      ],
                    });
                  }}
                >
                  将此权限应用到选中的 {selected.length} 篇
                </button>
              )}
            </section>
          )}
          <div className="community-publish-preview">
            <strong>{value.title}</strong>
            <p>{value.description}</p>
            <small>
              {docs.filter((d) => chosen(d.id)).length} 篇文章 · 保存后实时更新
            </small>
          </div>
          {config.data?.publication?.active && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => void publish(false)}
            >
              撤回整个知识库
            </button>
          )}
          {error && (
            <div role="alert" className="thought-error">
              {error}
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void config.refetch().then((result) => {
                    if (result.isSuccess) {
                      setDraft(null);
                      setError("");
                    }
                  })
                }
              >
                重新载入发布设置
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}
