import { useEffect, useMemo, useState } from "react";
import { Monitor, Save, Settings2, SlidersHorizontal } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { DialogueStyleInspector } from "@features/galgame-workshop/editor/DialogueStyleInspector";
import { DEFAULT_STORY_SETTINGS } from "@features/galgame-workshop/editor/model";
import { stableId } from "@features/galgame-workshop/editor/model";
import { StoryPlayer } from "@features/galgame-workshop/editor/StoryPlayer";

export function PersonalizationWorkspace({
  projectId,
  document,
  onDocument,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const chapter =
    document.chapters?.find((item) => item.id === document.entryChapterId) ??
    document.chapters?.[0];
  const fragment =
    chapter?.fragments?.find((item) => item.id === chapter.entryFragmentId) ??
    chapter?.fragments?.[0];
  const previewIndex = useMemo(() => {
    const index = fragment?.blocks?.findIndex((block) =>
      ["dialogue", "narration", "storyParagraph", "systemMessage"].includes(
        block.type,
      ),
    );
    return index != null && index >= 0 ? index : 0;
  }, [fragment]);
  return (
    <div className="galgame-personalization-workspace">
      <aside>
        <header>
          <small>PERSONALIZATION</small>
          <h2>个性化</h2>
          <p>统一调整对话框、舞台聚焦和游戏内 UI。</p>
        </header>
        <DialogueStyleInspector
          projectId={projectId}
          document={document}
          onDocument={onDocument}
        />
        <section className="galgame-personalization-official">
          <h3>文字与剧情段落</h3>
          <label>
            <span>全局打字速度（字/秒）</span>
            <input
              type="number"
              min="1"
              max="240"
              value={document.presentation?.text?.defaultSpeedCps ?? 40}
              onChange={(event) =>
                onDocument({
                  ...document,
                  presentation: {
                    ...document.presentation,
                    text: { defaultSpeedCps: Number(event.target.value) },
                  },
                })
              }
            />
          </label>
          <label>
            <span>默认段落样式</span>
            <select
              value={`${document.presentation?.paragraph?.defaultStyleRef?.source ?? "builtin"}:${document.presentation?.paragraph?.defaultStyleRef?.id ?? "classic"}`}
              onChange={(event) => {
                const [source, id] = event.target.value.split(":", 2);
                onDocument({
                  ...document,
                  presentation: {
                    ...document.presentation,
                    paragraph: {
                      defaultStyleRef: {
                        source: source as "builtin" | "project" | "extension",
                        id,
                      },
                      customStyles:
                        document.presentation?.paragraph?.customStyles ?? [],
                    },
                  },
                });
              }}
            >
              {[
                ["classic", "经典"],
                ["novel", "小说"],
                ["minimal", "极简"],
                ["cinema", "电影"],
              ].map(([id, label]) => (
                <option key={id} value={`builtin:${id}`}>
                  内置 · {label}
                </option>
              ))}
              {(document.presentation?.paragraph?.customStyles ?? []).map(
                (style) => (
                  <option key={style.id} value={`project:${style.id}`}>
                    项目 · {style.name}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              const id = stableId();
              onDocument({
                ...document,
                presentation: {
                  ...document.presentation,
                  paragraph: {
                    defaultStyleRef: { source: "project", id },
                    customStyles: [
                      ...(document.presentation?.paragraph?.customStyles ?? []),
                      {
                        id,
                        name: "自定义段落",
                        fontSizePx: 32,
                        lineHeight: 1.8,
                        textColor: "#FFFFFF",
                        readTextColor: "#9CA3AF",
                        backgroundColor: "#080E18",
                        contentWidth: 72,
                        align: "left",
                      },
                    ],
                  },
                },
              });
            }}
          >
            新建项目段落样式
          </button>
          {(document.presentation?.paragraph?.customStyles ?? []).map(
            (style) => (
              <details key={style.id}>
                <summary>{style.name}</summary>
                <input
                  aria-label="段落样式名称"
                  value={style.name}
                  onChange={(event) =>
                    onDocument({
                      ...document,
                      presentation: {
                        ...document.presentation,
                        paragraph: {
                          defaultStyleRef: document.presentation?.paragraph
                            ?.defaultStyleRef ?? {
                            source: "builtin",
                            id: "classic",
                          },
                          customStyles: (
                            document.presentation?.paragraph?.customStyles ?? []
                          ).map((item) =>
                            item.id === style.id
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        },
                      },
                    })
                  }
                />
                <div>
                  {(
                    ["textColor", "readTextColor", "backgroundColor"] as const
                  ).map((key) => (
                    <label key={key}>
                      <span>{key}</span>
                      <input
                        type="color"
                        value={style[key]}
                        onChange={(event) =>
                          onDocument({
                            ...document,
                            presentation: {
                              ...document.presentation,
                              paragraph: {
                                defaultStyleRef: document.presentation
                                  ?.paragraph?.defaultStyleRef ?? {
                                  source: "builtin",
                                  id: "classic",
                                },
                                customStyles: (
                                  document.presentation?.paragraph
                                    ?.customStyles ?? []
                                ).map((item) =>
                                  item.id === style.id
                                    ? { ...item, [key]: event.target.value }
                                    : item,
                                ),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            ),
          )}
        </section>
        <section className="galgame-personalization-official">
          <h3>标准系统消息</h3>
          <select
            aria-label="系统消息框来源"
            value={`${document.presentation?.systemMessage?.binding?.source ?? "builtin"}:${document.presentation?.systemMessage?.binding?.id ?? "standard-message"}`}
            onChange={(event) => {
              const [source, id] = event.target.value.split(":", 2);
              onDocument({
                ...document,
                presentation: {
                  ...document.presentation,
                  systemMessage: {
                    binding: {
                      source: source as "builtin" | "project" | "extension",
                      id,
                    },
                    customStyles:
                      document.presentation?.systemMessage?.customStyles ?? [],
                  },
                },
              });
            }}
          >
            <option value="builtin:standard-message">内置 · 标准消息框</option>
            {(document.presentation?.systemMessage?.customStyles ?? []).map(
              (style) => (
                <option key={style.id} value={`project:${style.id}`}>
                  项目 · {style.name}
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            onClick={() => {
              const id = stableId();
              onDocument({
                ...document,
                presentation: {
                  ...document.presentation,
                  systemMessage: {
                    binding: { source: "project", id },
                    customStyles: [
                      ...(document.presentation?.systemMessage?.customStyles ??
                        []),
                      {
                        id,
                        name: "自定义消息框",
                        panelColor: "#FFFFFF",
                        titleColor: "#111827",
                        textColor: "#374151",
                        accentColor: "#E75B55",
                        borderRadius: 12,
                        width: 520,
                      },
                    ],
                  },
                },
              });
            }}
          >
            新建项目消息框
          </button>
        </section>
      </aside>
      <main>
        <header>
          <span>
            <Monitor aria-hidden />
            <strong>实时游戏预览</strong>
          </span>
          <small>
            {document.settings?.canvas?.width ?? 1920} ×{" "}
            {document.settings?.canvas?.height ?? 1080}
          </small>
        </header>
        <div className="galgame-personalization-preview">
          <StoryPlayer
            document={document}
            mode="edit"
            editFragment={fragment}
            editBlockIndex={previewIndex}
          />
        </div>
        <p>
          预览使用入口章节的第一段可见正文；这里的修改会继续通过 Story revision
          自动保存。
        </p>
      </main>
    </div>
  );
}

type PositionKey = keyof typeof DEFAULT_STORY_SETTINGS.characterStage.positions;

export function ProjectSettingsWorkspace({
  title,
  document,
  savingTitle,
  onTitle,
  onDocument,
}: {
  title: string;
  document: GalgameStoryProject;
  savingTitle: boolean;
  onTitle: (title: string) => Promise<void>;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  useEffect(() => setDraftTitle(title), [title]);
  const settings = {
    canvas: { ...DEFAULT_STORY_SETTINGS.canvas, ...document.settings?.canvas },
    characterStage: {
      ...DEFAULT_STORY_SETTINGS.characterStage,
      ...document.settings?.characterStage,
      positions: {
        ...DEFAULT_STORY_SETTINGS.characterStage.positions,
        ...document.settings?.characterStage?.positions,
      },
    },
  };
  const updateSettings = (next: typeof settings) =>
    onDocument({ ...document, settings: next });
  const positionLabels: Record<PositionKey, string> = {
    left: "左",
    centerLeft: "左中",
    center: "中",
    centerRight: "右中",
    right: "右",
  };
  return (
    <div className="galgame-settings-workspace">
      <header>
        <span>
          <Settings2 aria-hidden />
          <small>PROJECT</small>
          <h2>项目设置</h2>
        </span>
        <p>项目名称独立保存；其余配置随 Story revision 自动保存。</p>
      </header>
      <div className="galgame-settings-grid">
        <section>
          <h3>基础信息</h3>
          <label>
            <span>项目名称</span>
            <div className="galgame-settings-title-field">
              <input
                value={draftTitle}
                maxLength={120}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
              <button
                type="button"
                disabled={
                  savingTitle ||
                  !draftTitle.trim() ||
                  draftTitle.trim() === title
                }
                onClick={() => void onTitle(draftTitle.trim())}
              >
                <Save aria-hidden /> {savingTitle ? "保存中" : "保存名称"}
              </button>
            </div>
          </label>
          <label>
            <span>项目简介</span>
            <textarea
              value={document.synopsis}
              maxLength={10000}
              onChange={(event) =>
                onDocument({ ...document, synopsis: event.target.value })
              }
            />
          </label>
          <label>
            <span>入口章节</span>
            <select
              value={document.entryChapterId ?? ""}
              onChange={(event) =>
                onDocument({ ...document, entryChapterId: event.target.value })
              }
            >
              {(document.chapters ?? [])
                .filter((chapter) => !chapter.disabled)
                .map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
            </select>
          </label>
        </section>
        <section>
          <h3>画布与舞台</h3>
          <div className="galgame-settings-pair">
            <label>
              <span>画布宽度</span>
              <input
                type="number"
                min="640"
                max="7680"
                value={settings.canvas.width}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    canvas: {
                      ...settings.canvas,
                      width: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              <span>画布高度</span>
              <input
                type="number"
                min="360"
                max="4320"
                value={settings.canvas.height}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    canvas: {
                      ...settings.canvas,
                      height: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <div className="galgame-settings-pair">
            <label>
              <span>默认锚点 X (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={settings.characterStage.anchorX}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    characterStage: {
                      ...settings.characterStage,
                      anchorX: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              <span>默认锚点 Y (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={settings.characterStage.anchorY}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    characterStage: {
                      ...settings.characterStage,
                      anchorY: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <label>
            <span>默认画面高度 (%)</span>
            <input
              type="number"
              min="1"
              max="400"
              step="1"
              value={settings.characterStage.defaultHeightPercent}
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  characterStage: {
                    ...settings.characterStage,
                    defaultHeightPercent: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </section>
        <section className="galgame-settings-positions">
          <h3>
            <SlidersHorizontal aria-hidden /> 五个标准站位
          </h3>
          <p>
            用于新建角色 Block 和资产预览，不会改写已有 Block 的 transform。
          </p>
          <div>
            {(Object.keys(positionLabels) as PositionKey[]).map((key) => (
              <label key={key}>
                <span>{positionLabels[key]}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={settings.characterStage.positions[key]}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      characterStage: {
                        ...settings.characterStage,
                        positions: {
                          ...settings.characterStage.positions,
                          [key]: Number(event.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
