import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  GitBranch,
  MoreHorizontal,
  Plus,
  Play,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { ChapterCast, Field } from "./EditorShared";
import {
  entryChapter,
  referencedBy,
  stableId,
  updateChapter,
  updateFragment,
} from "./model";
import type { ReadyEditorPageViewModel } from "./editorViewModel";

export function GalgameEditorStructurePanel({
  model,
}: {
  model: ReadyEditorPageViewModel;
}) {
  const {
    addChapter,
    addFragment,
    chapter,
    deleteChapter,
    deleteFragment,
    document,
    duplicateChapter,
    duplicateFragment,
    expandedChapterId,
    fragments,
    moveChapter,
    moveFragment,
    replaceDocument,
    selectChapter,
    selectFragment,
    selectedFragment,
    setExpandedChapterId,
    setStructureQuery,
    structureDrawerOpen,
    structureQuery,
  } = model;
  return (
    <aside
      className={`galgame-fragment-panel${structureDrawerOpen ? " is-drawer-open" : ""}`}
    >
      <div className="galgame-panel-heading">
        <span>
          <small>剧本结构</small>
        </span>
        <button type="button" aria-label="新建章节" onClick={addChapter}>
          <Plus aria-hidden /> 章节
        </button>
      </div>
      <label className="galgame-structure-search-field">
        <Search aria-hidden />
        <input
          className="galgame-structure-search"
          aria-label="搜索章节或 Fragment"
          placeholder="搜索章节 / 片段"
          value={structureQuery}
          onChange={(event) => setStructureQuery(event.target.value)}
        />
      </label>
      {entryChapter(document) ? (
        <button
          type="button"
          className="galgame-entry-fragment"
          onClick={() => selectChapter(entryChapter(document)!)}
        >
          <Play aria-hidden />
          <strong>开始</strong>
        </button>
      ) : null}
      <details className="galgame-story-settings">
        <summary>
          <Settings2 aria-hidden /> 故事设置 <ChevronDown aria-hidden />
        </summary>
        <Field label="故事简介">
          <textarea
            value={document.synopsis}
            placeholder="用几句话说明故事核心…"
            onChange={(event) =>
              replaceDocument({
                ...document,
                synopsis: event.target.value,
              })
            }
          />
        </Field>
        <div className="galgame-story-variables">
          <span>项目变量</span>
          {(document.variables ?? []).map((variable) => (
            <div key={variable.id}>
              <input
                aria-label={`${variable.name}名称`}
                value={variable.name}
                onChange={(event) =>
                  replaceDocument({
                    ...document,
                    variables: (document.variables ?? []).map((item) =>
                      item.id === variable.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <code>{variable.type}</code>
              <button
                type="button"
                aria-label={`删除变量 ${variable.name}`}
                disabled={
                  referencedBy(document, "variable", variable.id).length > 0
                }
                onClick={() =>
                  replaceDocument({
                    ...document,
                    variables: (document.variables ?? []).filter(
                      (item) => item.id !== variable.id,
                    ),
                  })
                }
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              replaceDocument({
                ...document,
                variables: [
                  ...(document.variables ?? []),
                  {
                    id: stableId(),
                    name: `变量 ${(document.variables?.length ?? 0) + 1}`,
                    type: "boolean",
                    defaultValue: false,
                    persistence: "session",
                    description: "",
                  },
                ],
              })
            }
          >
            <Plus aria-hidden /> 添加变量
          </button>
        </div>
        <Field label="章节名称">
          <input
            value={chapter.title}
            onChange={(event) =>
              replaceDocument(
                updateChapter(document, chapter.id, (current) => ({
                  ...current,
                  title: event.target.value,
                })),
              )
            }
          />
        </Field>
      </details>
      <div className="galgame-chapter-tree">
        {[...(document.chapters ?? [])]
          .sort((left, right) => left.order - right.order)
          .filter(
            (item) =>
              !structureQuery.trim() ||
              item.title.includes(structureQuery.trim()) ||
              item.fragments?.some((fragment) =>
                fragment.title.includes(structureQuery.trim()),
              ),
          )
          .map((item, chapterIndex) => {
            const branchCount = (item.fragments ?? []).reduce(
              (total, fragment) =>
                total +
                (fragment.blocks ?? []).filter(
                  (block) => block.type === "branch",
                ).length,
              0,
            );
            const expanded = expandedChapterId === item.id;
            return (
              <div
                key={item.id}
                className={item.id === chapter.id ? "active" : ""}
              >
                <div className="galgame-chapter-row">
                  <button
                    type="button"
                    className="galgame-chapter-main"
                    onClick={() => selectChapter(item)}
                  >
                    <span className="galgame-chapter-number">
                      {String(chapterIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="galgame-chapter-copy">
                      <span>
                        <strong>{item.title}</strong>
                        {document.entryChapterId === item.id ? (
                          <i>入口章</i>
                        ) : null}
                        {item.disabled ? <i>已禁用</i> : null}
                      </span>
                      <small>
                        <ChapterCast document={document} chapter={item} />
                        {branchCount > 0 ? (
                          <em>
                            <GitBranch aria-hidden /> {branchCount}
                          </em>
                        ) : null}
                        {item.fragments?.length ?? 0} 片段
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="galgame-chapter-expand"
                    aria-label={`${expanded ? "收起" : "展开"}${item.title}片段`}
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedChapterId(expanded ? undefined : item.id)
                    }
                  >
                    <ChevronDown aria-hidden />
                  </button>
                </div>
                {expanded ? (
                  <div className="galgame-fragment-list">
                    {(item.fragments ?? [])
                      .filter(
                        (fragment) =>
                          !structureQuery.trim() ||
                          fragment.title.includes(structureQuery.trim()),
                      )
                      .map((fragment) => (
                        <button
                          key={fragment.id}
                          type="button"
                          className={
                            selectedFragment?.id === fragment.id ? "active" : ""
                          }
                          onClick={() => selectFragment(fragment)}
                        >
                          <span>
                            <GitBranch aria-hidden />
                            <strong>{fragment.title}</strong>
                          </span>
                          <span>
                            {item.entryFragmentId === fragment.id ? (
                              <em>入口</em>
                            ) : null}
                            <small>{fragment.blocks?.length ?? 0}</small>
                          </span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
      <div className="galgame-structure-actions">
        <button type="button" onClick={addFragment}>
          <Plus aria-hidden /> Fragment
        </button>
        <details className="galgame-structure-actions-menu">
          <summary aria-label="章节与片段操作">
            <MoreHorizontal aria-hidden />
          </summary>
          <div>
            <button
              type="button"
              aria-label="章节上移"
              disabled={chapter.order <= 1}
              onClick={() => moveChapter(chapter, -1)}
            >
              <ArrowUp aria-hidden /> 章节上移
            </button>
            <button
              type="button"
              aria-label="章节下移"
              disabled={
                chapter.order >= Math.max(1, document.chapters?.length ?? 1)
              }
              onClick={() => moveChapter(chapter, 1)}
            >
              <ArrowDown aria-hidden /> 章节下移
            </button>
            <button
              type="button"
              aria-label="复制章节"
              onClick={() => duplicateChapter(chapter)}
            >
              <Copy aria-hidden /> 复制章节
            </button>
            <button
              type="button"
              disabled={document.entryChapterId === chapter.id}
              onClick={() =>
                replaceDocument(
                  updateChapter(
                    { ...document, entryChapterId: chapter.id },
                    chapter.id,
                    (current) => ({ ...current, disabled: false }),
                  ),
                )
              }
            >
              设为入口章
            </button>
            <button
              type="button"
              disabled={document.entryChapterId === chapter.id}
              onClick={() =>
                replaceDocument(
                  updateChapter(document, chapter.id, (current) => ({
                    ...current,
                    disabled: !current.disabled,
                  })),
                )
              }
            >
              {chapter.disabled ? "启用" : "禁用"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => deleteChapter(chapter)}
            >
              删除章
            </button>
          </div>
        </details>
      </div>
      {selectedFragment ? (
        <details className="galgame-fragment-actions">
          <summary>当前片段 · {selectedFragment.title}</summary>
          <div>
            <input
              aria-label="结构树 Fragment 名称"
              value={selectedFragment.title}
              onChange={(event) =>
                replaceDocument(
                  updateFragment(document, selectedFragment.id, (current) => ({
                    ...current,
                    title: event.target.value,
                  })),
                )
              }
            />
            <button
              type="button"
              aria-label="Fragment 上移"
              disabled={fragments[0]?.id === selectedFragment.id}
              onClick={() => moveFragment(selectedFragment, -1)}
            >
              <ArrowUp aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Fragment 下移"
              disabled={fragments.at(-1)?.id === selectedFragment.id}
              onClick={() => moveFragment(selectedFragment, 1)}
            >
              <ArrowDown aria-hidden />
            </button>
            <button
              type="button"
              aria-label="复制 Fragment"
              onClick={() => duplicateFragment(selectedFragment)}
            >
              <Copy aria-hidden />
            </button>
            <button
              type="button"
              disabled={chapter.entryFragmentId === selectedFragment.id}
              onClick={() =>
                replaceDocument(
                  updateChapter(document, chapter.id, (current) => ({
                    ...current,
                    entryFragmentId: selectedFragment.id,
                  })),
                )
              }
            >
              设为入口
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => deleteFragment(selectedFragment)}
            >
              删除
            </button>
          </div>
        </details>
      ) : null}
      <footer>
        <span /> {fragments.length} 个 Fragment · 自动保存已开启
      </footer>
    </aside>
  );
}
