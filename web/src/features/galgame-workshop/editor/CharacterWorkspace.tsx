import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  FileImage,
  FolderOpen,
  ImagePlus,
  LocateFixed,
  Mic2,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
  Volume2,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryCharacter,
  type GalgameStoryCharacterExpression,
  type GalgameStoryProject,
  type GalgameStoryAudioAsset,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

type Reference = {
  chapterId: string;
  chapterTitle: string;
  fragmentId: string;
  fragmentTitle: string;
  blockId: string;
  blockIndex: number;
  text: string;
  expressionId?: string | null;
};

function referencesForCharacter(
  document: GalgameStoryProject,
  characterId: string,
) {
  const references: Reference[] = [];
  for (const chapter of document.chapters ?? []) {
    for (const fragment of chapter.fragments ?? []) {
      for (const [blockIndex, block] of (fragment.blocks ?? []).entries()) {
        if (
          (block.type !== "dialogue" &&
            block.type !== "showCharacter" &&
            block.type !== "removeCharacter") ||
          (block.type === "dialogue"
            ? !dialogueSpeakerIds(block).includes(characterId)
            : block.characterId !== characterId)
        )
          continue;
        references.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          fragmentId: fragment.id,
          fragmentTitle: fragment.title,
          blockId: block.id,
          blockIndex,
          text:
            block.type === "dialogue"
              ? block.text
              : block.type === "showCharacter"
                ? "角色登场 / 调整"
                : "角色退场",
          expressionId:
            block.type === "dialogue" || block.type === "showCharacter"
              ? block.expressionId
              : undefined,
        });
      }
    }
  }
  return references;
}

function displayLabel(filename: string, fallback: string) {
  const label = filename.replace(/\.[^.]+$/, "").trim();
  return label || fallback;
}

function CharacterAvatar({
  character,
  document,
}: {
  character: GalgameStoryCharacter;
  document: GalgameStoryProject;
}) {
  const expression = (character.expressions ?? []).find(
    (item) => item.id === character.defaultExpressionId,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === expression?.assetId,
  );
  return (
    <span className="galgame-character-avatar">
      <StoryAssetImage
        fileId={asset?.fileId}
        alt=""
        fallback={<b>{character.name.slice(0, 1) || "角"}</b>}
      />
    </span>
  );
}

export function CharacterWorkspace({
  projectId,
  document,
  onDocument,
  onLocate,
  onNotice,
  focusCharacterId,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
  focusCharacterId?: string;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const voiceFileInput = useRef<HTMLInputElement>(null);
  const characters = useMemo(
    () => document.characters ?? [],
    [document.characters],
  );
  const [query, setQuery] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    characters[0]?.id,
  );
  const [selectedExpressionId, setSelectedExpressionId] = useState<string>();
  const [tab, setTab] = useState<"base" | "portraits" | "voice">("portraits");
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [uploadError, setUploadError] = useState("");
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voicePickerSource, setVoicePickerSource] =
    useState<StoryAudioPickerSource>("project");
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ??
    characters[0];
  const expressions = useMemo(
    () => selectedCharacter?.expressions ?? [],
    [selectedCharacter?.expressions],
  );
  const selectedExpression =
    expressions.find((expression) => expression.id === selectedExpressionId) ??
    expressions.find(
      (expression) => expression.id === selectedCharacter?.defaultExpressionId,
    ) ??
    expressions[0];
  const references = selectedCharacter
    ? referencesForCharacter(document, selectedCharacter.id)
    : [];
  const fragmentCount = new Set(
    references.map((reference) => reference.fragmentId),
  ).size;
  const filtered = characters.filter((character) =>
    character.name
      .toLocaleLowerCase("zh-CN")
      .includes(query.toLocaleLowerCase("zh-CN")),
  );
  const assetsById = new Map(
    (document.assets ?? []).map((asset) => [asset.id, asset]),
  );
  const usedFileIds = useMemo(
    () => new Set((document.assets ?? []).map((asset) => asset.fileId)),
    [document.assets],
  );

  useEffect(() => {
    if (!selectedCharacter && characters[0])
      setSelectedCharacterId(characters[0].id);
  }, [characters, selectedCharacter]);

  useEffect(() => {
    if (!focusCharacterId) return;
    if (characters.some((character) => character.id === focusCharacterId)) {
      setSelectedCharacterId(focusCharacterId);
      setTab("voice");
    }
  }, [characters, focusCharacterId]);

  useEffect(() => {
    if (!selectedExpression && expressions[0])
      setSelectedExpressionId(
        selectedCharacter?.defaultExpressionId ?? expressions[0].id,
      );
  }, [expressions, selectedCharacter, selectedExpression]);

  const updateCharacter = (
    characterId: string,
    updater: (character: GalgameStoryCharacter) => GalgameStoryCharacter,
  ) =>
    onDocument({
      ...document,
      characters: characters.map((character) =>
        character.id === characterId ? updater(character) : character,
      ),
    });

  const bindFile = (fileId: string, name: string) => {
    if (!selectedCharacter || !picker) return;
    if (picker.mode === "replace" && selectedExpression) {
      onDocument({
        ...document,
        assets: (document.assets ?? []).map((asset) =>
          asset.id === selectedExpression.assetId
            ? { ...asset, fileId }
            : asset,
        ),
      });
      setPicker(undefined);
      return;
    }
    const assetId = stableId();
    const expressionId = stableId();
    const expression: GalgameStoryCharacterExpression = {
      id: expressionId,
      label: displayLabel(name, `表情 ${expressions.length + 1}`),
      assetId,
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []),
        {
          id: assetId,
          type: "image",
          role: "characterPortrait",
          fileId,
          status: "ready",
        },
      ],
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              expressions: [...(character.expressions ?? []), expression],
              defaultExpressionId:
                character.defaultExpressionId ?? expressionId,
            }
          : character,
      ),
    });
    setSelectedExpressionId(expressionId);
    setPicker(undefined);
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      setUploadError("");
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "立绘上传失败"),
  });

  const bindVoiceSample = (fileId: string, name: string) => {
    if (!selectedCharacter) return;
    const previousId = selectedCharacter.voiceProfile?.sampleAssetId;
    const previousStillUsed = characters.some(
      (character) =>
        character.id !== selectedCharacter.id &&
        character.voiceProfile?.sampleAssetId === previousId,
    );
    const assetId = stableId();
    const asset: GalgameStoryAudioAsset = {
      id: assetId,
      type: "audio",
      role: "voiceSample",
      label: displayLabel(name, "声线样本"),
      fileId,
      status: "ready",
    };
    onDocument({
      ...document,
      assets: [
        ...(document.assets ?? []).filter(
          (item) => item.id !== previousId || previousStillUsed,
        ),
        asset,
      ],
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              voiceProfile: {
                name: character.voiceProfile?.name ?? "默认声线",
                language: character.voiceProfile?.language ?? "zh-CN",
                description: character.voiceProfile?.description ?? "",
                sampleAssetId: assetId,
              },
            }
          : character,
      ),
    });
    setVoicePickerOpen(false);
  };

  const voiceUpload = useMutation({
    mutationFn: (file: File) => uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset) => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindVoiceSample(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "声线样本上传失败"),
  });

  const deleteExpression = (expression: GalgameStoryCharacterExpression) => {
    if (!selectedCharacter) return;
    const explicit = references.filter(
      (reference) => reference.expressionId === expression.id,
    );
    if (explicit.length) {
      onNotice(`无法删除：表情仍被 ${explicit.length} 处剧本演出显式引用。`);
      return;
    }
    if (
      selectedCharacter.defaultExpressionId === expression.id &&
      expressions.length > 1
    ) {
      onNotice("请先将其他表情设为默认，再删除当前默认表情。");
      return;
    }
    const remaining = expressions.filter((item) => item.id !== expression.id);
    const assetStillUsed = characters.some((character) =>
      (character.expressions ?? []).some(
        (item) =>
          (character.id !== selectedCharacter.id ||
            item.id !== expression.id) &&
          item.assetId === expression.assetId,
      ),
    );
    onDocument({
      ...document,
      assets: assetStillUsed
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== expression.assetId,
          ),
      characters: characters.map((character) =>
        character.id === selectedCharacter.id
          ? {
              ...character,
              expressions: remaining,
              defaultExpressionId: remaining.length
                ? character.defaultExpressionId
                : null,
            }
          : character,
      ),
    });
    setSelectedExpressionId(remaining[0]?.id);
  };

  const deleteCharacter = () => {
    if (!selectedCharacter) return;
    if (references.length) {
      onNotice(`无法删除：角色仍被 ${references.length} 处剧本演出引用。`);
      return;
    }
    const expressionAssetIds = new Set(
      expressions.map((expression) => expression.assetId),
    );
    const remainingCharacters = characters.filter(
      (character) => character.id !== selectedCharacter.id,
    );
    const assetsUsedElsewhere = new Set(
      remainingCharacters.flatMap((character) =>
        (character.expressions ?? []).map((expression) => expression.assetId),
      ),
    );
    onDocument({
      ...document,
      characters: remainingCharacters,
      assets: (document.assets ?? []).filter(
        (asset) =>
          !expressionAssetIds.has(asset.id) ||
          assetsUsedElsewhere.has(asset.id),
      ),
    });
    setSelectedCharacterId(remainingCharacters[0]?.id);
  };

  const activeAsset = selectedExpression
    ? assetsById.get(selectedExpression.assetId)
    : undefined;
  const voiceSampleAsset = (document.assets ?? []).find(
    (asset): asset is GalgameStoryAudioAsset =>
      asset.type === "audio" &&
      asset.id === selectedCharacter?.voiceProfile?.sampleAssetId,
  );

  return (
    <section className="galgame-character-workspace">
      <aside className="galgame-character-list-panel">
        <header>
          <strong>角色列表</strong>
          <em>{characters.length}</em>
        </header>
        <label className="galgame-character-search">
          <Search aria-hidden />
          <input
            aria-label="搜索角色"
            value={query}
            placeholder="搜索角色…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="galgame-character-create"
          onClick={() => {
            const id = stableId();
            onDocument({
              ...document,
              characters: [
                ...characters,
                {
                  id,
                  name: "新角色",
                  description: "",
                  expressions: [],
                  defaultExpressionId: null,
                },
              ],
            });
            setSelectedCharacterId(id);
            setSelectedExpressionId(undefined);
          }}
        >
          <Plus aria-hidden /> 新建角色
        </button>
        <div className="galgame-character-list">
          {filtered.map((character) => {
            const count = referencesForCharacter(document, character.id).length;
            return (
              <button
                key={character.id}
                type="button"
                className={
                  character.id === selectedCharacter?.id ? "active" : ""
                }
                onClick={() => {
                  setSelectedCharacterId(character.id);
                  setSelectedExpressionId(
                    character.defaultExpressionId ?? undefined,
                  );
                }}
              >
                <CharacterAvatar character={character} document={document} />
                <span>
                  <strong>{character.name}</strong>
                  <small>{count} 处对白</small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            );
          })}
        </div>
      </aside>

      <main className="galgame-character-detail-panel">
        {selectedCharacter ? (
          <>
            <header>
              <div>
                <strong>角色资料</strong>
                <span>编辑角色的基础信息、基准立绘与表情差分。</span>
              </div>
              <nav aria-label="角色资料分类">
                <button
                  type="button"
                  className={tab === "base" ? "active" : ""}
                  onClick={() => setTab("base")}
                >
                  基础资料
                </button>
                <button
                  type="button"
                  className={tab === "portraits" ? "active" : ""}
                  onClick={() => setTab("portraits")}
                >
                  立绘与表情
                </button>
                <button
                  type="button"
                  className={tab === "voice" ? "active" : ""}
                  onClick={() => setTab("voice")}
                >
                  声线资料
                </button>
              </nav>
            </header>
            {tab === "base" ? (
              <div className="galgame-character-base-form">
                <label className="galgame-field">
                  <span>角色名称</span>
                  <input
                    value={selectedCharacter.name}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>设定说明</span>
                  <textarea
                    value={selectedCharacter.description}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>角色 ID（只读）</span>
                  <input value={selectedCharacter.id} readOnly />
                </label>
                <small>修改将在 650ms 后自动保存。</small>
              </div>
            ) : tab === "portraits" ? (
              <div className="galgame-portrait-editor">
                <div className="galgame-portrait-stage-column">
                  <div className="galgame-portrait-stage">
                    <StoryAssetImage
                      fileId={activeAsset?.fileId}
                      alt={`${selectedCharacter.name} · ${selectedExpression?.label ?? "立绘"}`}
                      fallback={
                        <span>
                          <UserRound aria-hidden />
                          <strong>尚未绑定基准立绘</strong>
                          <small>上传图片或从文件库选择。</small>
                        </span>
                      }
                    />
                  </div>
                  <div className="galgame-portrait-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({
                          mode: selectedExpression ? "replace" : "add",
                          source: "project",
                        });
                        requestAnimationFrame(() => fileInput.current?.click());
                      }}
                    >
                      <Upload aria-hidden />
                      {selectedExpression ? "替换立绘" : "上传立绘"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPicker({
                          mode: selectedExpression ? "replace" : "add",
                          source: "library",
                        })
                      }
                    >
                      <FolderOpen aria-hidden /> 从文件库选择
                    </button>
                  </div>
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.avif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) upload.mutate(file);
                      event.target.value = "";
                    }}
                  />
                  {upload.isPending ? <small>正在上传立绘…</small> : null}
                  {uploadError ? (
                    <small className="danger">{uploadError}</small>
                  ) : null}
                </div>
                <div className="galgame-expression-column">
                  <header>
                    <strong>表情集合</strong>
                    <span>{expressions.length}</span>
                  </header>
                  <div className="galgame-expression-grid">
                    {expressions.map((expression) => {
                      const asset = assetsById.get(expression.assetId);
                      return (
                        <button
                          key={expression.id}
                          type="button"
                          className={
                            expression.id === selectedExpression?.id
                              ? "active"
                              : ""
                          }
                          onClick={() => setSelectedExpressionId(expression.id)}
                        >
                          <span>
                            <StoryAssetImage
                              fileId={asset?.fileId}
                              alt=""
                              fallback={<FileImage aria-hidden />}
                            />
                          </span>
                          <strong>{expression.label}</strong>
                          {expression.id ===
                          selectedCharacter.defaultExpressionId ? (
                            <em>默认</em>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="galgame-expression-add"
                      onClick={() =>
                        setPicker({ mode: "add", source: "project" })
                      }
                    >
                      <ImagePlus aria-hidden /> 添加表情
                    </button>
                  </div>
                  {selectedExpression ? (
                    <div className="galgame-expression-form">
                      <label className="galgame-field">
                        <span>表情名称</span>
                        <input
                          value={selectedExpression.label}
                          onChange={(event) =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                expressions: (character.expressions ?? []).map(
                                  (expression) =>
                                    expression.id === selectedExpression.id
                                      ? {
                                          ...expression,
                                          label: event.target.value,
                                        }
                                      : expression,
                                ),
                              }),
                            )
                          }
                        />
                      </label>
                      <label className="galgame-field">
                        <span>表情 ID（只读）</span>
                        <input value={selectedExpression.id} readOnly />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={
                            selectedExpression.id ===
                            selectedCharacter.defaultExpressionId
                          }
                          onClick={() =>
                            updateCharacter(
                              selectedCharacter.id,
                              (character) => ({
                                ...character,
                                defaultExpressionId: selectedExpression.id,
                              }),
                            )
                          }
                        >
                          <Check aria-hidden /> 设为默认
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => deleteExpression(selectedExpression)}
                        >
                          <Trash2 aria-hidden /> 删除表情
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <footer>
                    <Check aria-hidden />
                    {expressions.length
                      ? "基准立绘已绑定 · 修改将在 650ms 后自动保存"
                      : "添加第一个表情后会自动设为默认立绘"}
                  </footer>
                </div>
              </div>
            ) : (
              <div className="galgame-character-voice-form">
                <section>
                  <header>
                    <span>
                      <Mic2 aria-hidden />
                    </span>
                    <span>
                      <strong>角色声线</strong>
                      <small>记录配音选角资料和试听样本。</small>
                    </span>
                  </header>
                  <label className="galgame-field">
                    <span>声线名称</span>
                    <input
                      value={selectedCharacter.voiceProfile?.name ?? "默认声线"}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: event.target.value,
                            language:
                              character.voiceProfile?.language ?? "zh-CN",
                            description:
                              character.voiceProfile?.description ?? "",
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="galgame-field">
                    <span>语言</span>
                    <input
                      value={
                        selectedCharacter.voiceProfile?.language ?? "zh-CN"
                      }
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: character.voiceProfile?.name ?? "默认声线",
                            language: event.target.value,
                            description:
                              character.voiceProfile?.description ?? "",
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="galgame-field">
                    <span>声线描述</span>
                    <textarea
                      placeholder="例如：冷静、偏低沉，句尾略带气声…"
                      value={selectedCharacter.voiceProfile?.description ?? ""}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          voiceProfile: {
                            name: character.voiceProfile?.name ?? "默认声线",
                            language:
                              character.voiceProfile?.language ?? "zh-CN",
                            description: event.target.value,
                            sampleAssetId:
                              character.voiceProfile?.sampleAssetId ?? null,
                          },
                        }))
                      }
                    />
                  </label>
                </section>
                <section className="galgame-character-voice-sample">
                  <header>
                    <strong>试听样本</strong>
                    <small>仅用于选角参考，不会自动绑定到对白。</small>
                  </header>
                  {voiceSampleAsset ? (
                    <StoryAudioPreview
                      fileId={voiceSampleAsset.fileId}
                      label={voiceSampleAsset.label}
                    />
                  ) : (
                    <div className="galgame-character-voice-empty">
                      <Volume2 aria-hidden />
                      <strong>尚未添加试听样本</strong>
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={() => voiceFileInput.current?.click()}
                    >
                      <Upload aria-hidden /> 上传样本
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVoicePickerSource("library");
                        setVoicePickerOpen(true);
                      }}
                    >
                      <FolderOpen aria-hidden /> 从文件库选择
                    </button>
                    {voiceSampleAsset ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() =>
                          updateCharacter(
                            selectedCharacter.id,
                            (character) => ({
                              ...character,
                              voiceProfile: character.voiceProfile
                                ? {
                                    ...character.voiceProfile,
                                    sampleAssetId: null,
                                  }
                                : null,
                            }),
                          )
                        }
                      >
                        <Trash2 aria-hidden /> 移除
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={voiceFileInput}
                    hidden
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) voiceUpload.mutate(file);
                    }}
                  />
                </section>
              </div>
            )}
          </>
        ) : (
          <div className="galgame-entity-empty">
            <UserRound aria-hidden />
            <strong>还没有角色</strong>
            <span>从左侧创建角色后开始编辑资料与立绘。</span>
          </div>
        )}
      </main>

      <aside className="galgame-character-reference-panel">
        <section>
          <header>
            <strong>对白引用</strong>
          </header>
          <div className="galgame-character-reference-metrics">
            <span>
              <strong>{references.length}</strong>
              <small>处对白</small>
            </span>
            <span>
              <strong>{fragmentCount}</strong>
              <small>个 Fragment</small>
            </span>
          </div>
          <div className="galgame-character-reference-list">
            {references.map((reference) => (
              <button
                key={reference.blockId}
                type="button"
                onClick={() =>
                  onLocate(reference.fragmentId, reference.blockId)
                }
              >
                <span>
                  <strong>
                    {reference.chapterTitle} · {reference.fragmentTitle} · Block{" "}
                    {reference.blockIndex + 1}
                  </strong>
                  <small>{reference.text || "（空对白）"}</small>
                </span>
                <ChevronRight aria-hidden />
              </button>
            ))}
            {!references.length ? <p>这个角色还没有被对白引用。</p> : null}
          </div>
          {references[0] ? (
            <button
              type="button"
              className="galgame-character-locate"
              onClick={() =>
                onLocate(references[0].fragmentId, references[0].blockId)
              }
            >
              <LocateFixed aria-hidden /> 定位到剧本
            </button>
          ) : null}
          {selectedCharacter?.defaultExpressionId ? (
            <p className="galgame-character-preview-state">
              <UserRound aria-hidden /> 试玩默认使用：
              <strong>
                {
                  expressions.find(
                    (expression) =>
                      expression.id === selectedCharacter.defaultExpressionId,
                  )?.label
                }
              </strong>
            </p>
          ) : null}
        </section>
        <section className="galgame-character-danger-zone">
          <header>
            <strong>删除角色</strong>
            <span>
              {references.length
                ? "角色仍被对白引用，无法删除。"
                : "删除角色会同时解除其立绘绑定。"}
            </span>
          </header>
          <button
            type="button"
            disabled={!selectedCharacter || Boolean(references.length)}
            onClick={deleteCharacter}
          >
            <Trash2 aria-hidden /> 删除角色
          </button>
        </section>
      </aside>

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加角色表情"
          replaceTitle="替换角色立绘"
          searchLabel="搜索立绘素材"
          projectEmptyCopy="上传图片后即可绑定为角色立绘。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
      {voicePickerOpen ? (
        <StoryAudioPicker
          projectId={projectId}
          title="选择角色试听样本"
          source={voicePickerSource}
          usedFileIds={usedFileIds}
          onSource={setVoicePickerSource}
          onChoose={bindVoiceSample}
          onUpload={() => voiceFileInput.current?.click()}
          onClose={() => setVoicePickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
