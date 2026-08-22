import {
  Check,
  FileImage,
  FolderOpen,
  ImagePlus,
  PanelRight,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { StoryImagePicker } from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { StoryAudioPicker } from "@features/galgame-workshop/editor/StoryAudioPicker";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { InlineEditableName } from "@features/galgame-workshop/editor/EditorShared";
import { CharacterAvatar } from "@features/galgame-workshop/editor/CharacterAvatar";
import { characterThumbnailCropStyle } from "@features/galgame-workshop/editor/characterThumbnail";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/characterWorkspaceViewModel";
import { CharacterListPanel } from "@features/galgame-workshop/editor/CharacterListPanel";
import { CharacterProfilePanel } from "@features/galgame-workshop/editor/CharacterProfilePanel";
import { CharacterExpressionForm } from "@features/galgame-workshop/editor/CharacterExpressionForm";
import { CharacterSkinPanel } from "@features/galgame-workshop/editor/CharacterSkinPanel";
import { CharacterVoicePanel } from "@features/galgame-workshop/editor/CharacterVoicePanel";
import { CharacterReferencePanel } from "@features/galgame-workshop/editor/CharacterReferencePanel";
export function CharacterWorkspaceView({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    projectId,
    document,
    onNotice,
    fileInput,
    voiceFileInput,
    characters,
    setSelectedExpressionId,
    selectedExpressionIds,
    setSelectedExpressionIds,
    lastExpressionIndex,
    setLastExpressionIndex,
    draggedExpressionId,
    setDraggedExpressionId,
    expressionDropTarget,
    setExpressionDropTarget,
    setSelectedDisplayNameId,
    setSelectedSkinId,
    tab,
    setTab,
    workspaceMode,
    setReferenceTab,
    picker,
    setPicker,
    confirmStaticMode,
    setConfirmStaticMode,
    referencePanelOpen,
    setReferencePanelOpen,
    uploadError,
    voicePickerOpen,
    setVoicePickerOpen,
    voicePickerSource,
    setVoicePickerSource,
    selectedCharacter,
    expressions,
    selectedExpression,
    references,
    expressionDetailLayout,
    assetsById,
    usedFileIds,
    updateCharacter,
    applyExpressionStaticMode,
    appendSequenceFiles,
    bindFile,
    upload,
    batchUpload,
    sequenceBatchUpload,
    bindVoiceSample,
    deleteSelectedExpressions,
    moveExpression,
    moveExpressionByOffset,
    stageWorkspace,
    templatesWorkspace,
  } = model;
  return (
    <section
      className={`galgame-character-workspace ${
        expressionDetailLayout ? "is-expression-detail" : ""
      } ${workspaceMode === "stage" ? "is-stage-settings" : ""}`}
    >
      <header className="galgame-character-workspace-header">
        <span>
          <UserRound aria-hidden />
          <strong>角色</strong>
          <em>{characters.length} 项</em>
        </span>
        {expressionDetailLayout ? (
          <button
            type="button"
            className="galgame-character-reference-trigger"
            aria-expanded={referencePanelOpen}
            onClick={() => {
              setReferenceTab("references");
              setReferencePanelOpen((current) => !current);
            }}
          >
            <PanelRight aria-hidden /> 资源引用
            {references.length ? <em>{references.length}</em> : null}
          </button>
        ) : null}
      </header>
      <CharacterListPanel model={model} />

      <main className="galgame-character-detail-panel">
        {workspaceMode === "stage" ? (
          stageWorkspace
        ) : workspaceMode === "templates" ? (
          templatesWorkspace
        ) : selectedCharacter ? (
          <>
            <header>
              <div className="galgame-character-current-summary">
                <CharacterAvatar
                  character={selectedCharacter}
                  document={document}
                />
                <span>
                  <InlineEditableName
                    key={selectedCharacter.id}
                    value={selectedCharacter.name}
                    label="角色名称"
                    onCommit={(name) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        name,
                      }))
                    }
                    onEmpty={() => onNotice("角色名称不能为空。")}
                  />
                  <small>{expressions.length} 个表情</small>
                </span>
              </div>
              <nav aria-label="角色资料分类">
                <button
                  type="button"
                  className={tab === "expressions" ? "active" : ""}
                  onClick={() => setTab("expressions")}
                >
                  表情资源 <em>{expressions.length}</em>
                </button>
                <button
                  type="button"
                  className={tab === "skins" ? "active" : ""}
                  onClick={() => {
                    setTab("skins");
                    setSelectedSkinId(
                      selectedCharacter.defaultPortraitSkinId ??
                        selectedCharacter.portraitSkins?.[0]?.id,
                    );
                  }}
                >
                  立绘皮肤{" "}
                  <em>{selectedCharacter.portraitSkins?.length ?? 0}</em>
                </button>
                <button
                  type="button"
                  className={tab === "displayNames" ? "active" : ""}
                  onClick={() => {
                    setTab("displayNames");
                    setSelectedDisplayNameId("main");
                  }}
                >
                  显示名 <em>{selectedCharacter.displayNames?.length ?? 0}</em>
                </button>
                <button
                  type="button"
                  className={tab === "attributes" ? "active" : ""}
                  onClick={() => setTab("attributes")}
                >
                  角色属性{" "}
                  <em>{document.characterAttributeTemplates?.length ?? 0}</em>
                </button>
              </nav>
            </header>
            {tab === "displayNames" || tab === "attributes" ? (
              <CharacterProfilePanel model={model} />
            ) : tab === "expressions" || tab === "skins" ? (
              <div
                className={`galgame-portrait-editor is-${tab} ${
                  selectedExpression?.renderMode === "frameSequence"
                    ? "has-frame-sequence"
                    : "has-static-image"
                }`}
              >
                <div className="galgame-portrait-stage-column galgame-expression-upload-status">
                  {!selectedExpression ? (
                    <div className="galgame-expression-detail-empty">
                      <FileImage aria-hidden />
                      <span>选择一个表情查看详情</span>
                    </div>
                  ) : null}
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.avif"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length && picker?.mode === "sequence")
                        sequenceBatchUpload.mutate(files);
                      else if (files.length === 1 && picker?.mode === "replace")
                        upload.mutate(files[0]);
                      else if (files.length) batchUpload.mutate(files);
                      event.target.value = "";
                    }}
                  />
                  {upload.isPending ||
                  batchUpload.isPending ||
                  sequenceBatchUpload.isPending ? (
                    <small>正在导入立绘…</small>
                  ) : null}
                  {uploadError ? (
                    <small className="danger">{uploadError}</small>
                  ) : null}
                </div>
                <div className="galgame-expression-column">
                  <label className="galgame-expression-avatar-toggle">
                    <span className="galgame-expression-avatar-icon">
                      <UserRound aria-hidden />
                    </span>
                    <strong>对白头像</strong>
                    <input
                      type="checkbox"
                      checked={
                        selectedCharacter.dialogueAvatar?.enabled ?? false
                      }
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, (character) => ({
                          ...character,
                          dialogueAvatar: { enabled: event.target.checked },
                        }))
                      }
                    />
                    <i aria-hidden />
                  </label>
                  <div className="galgame-expression-grid">
                    {selectedExpressionIds.size > 1 ? (
                      <div className="galgame-expression-selection-actions">
                        <span>已选择 {selectedExpressionIds.size} 个表情</span>
                        <button
                          type="button"
                          className="danger"
                          onClick={deleteSelectedExpressions}
                        >
                          <Trash2 aria-hidden /> 删除所选（
                          {selectedExpressionIds.size}）
                        </button>
                      </div>
                    ) : null}
                    {expressions.map((expression) => {
                      const asset = assetsById.get(expression.assetId);
                      return (
                        <button
                          key={`${selectedCharacter.id}:${expression.id}`}
                          type="button"
                          draggable
                          aria-roledescription="可排序表情卡片"
                          title="拖动调整表情顺序；Alt+↑/↓ 也可移动"
                          className={[
                            expression.id === selectedExpression?.id ||
                            selectedExpressionIds.has(expression.id)
                              ? "active"
                              : "",
                            draggedExpressionId === expression.id
                              ? "is-dragging"
                              : "",
                            expressionDropTarget?.id === expression.id
                              ? `is-drop-${expressionDropTarget.placement}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={(event) => {
                            const index = expressions.findIndex(
                              (item) => item.id === expression.id,
                            );
                            if (event.shiftKey && lastExpressionIndex != null) {
                              const [start, end] = [
                                lastExpressionIndex,
                                index,
                              ].sort((left, right) => left - right);
                              setSelectedExpressionIds(
                                new Set(
                                  expressions
                                    .slice(start, end + 1)
                                    .map((item) => item.id),
                                ),
                              );
                            } else if (event.metaKey || event.ctrlKey) {
                              setSelectedExpressionIds((current) => {
                                const next = new Set(current);
                                if (next.has(expression.id))
                                  next.delete(expression.id);
                                else next.add(expression.id);
                                return next;
                              });
                            } else {
                              setSelectedExpressionIds(
                                new Set([expression.id]),
                              );
                            }
                            setSelectedExpressionId(expression.id);
                            setLastExpressionIndex(index);
                          }}
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (
                              event.key !== "ArrowUp" &&
                              event.key !== "ArrowDown"
                            )
                              return;
                            event.preventDefault();
                            moveExpressionByOffset(
                              expression.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "application/x-galgame-expression",
                              expression.id,
                            );
                            event.dataTransfer.setData(
                              "text/plain",
                              expression.id,
                            );
                            setDraggedExpressionId(expression.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            setExpressionDropTarget({
                              id: expression.id,
                              placement:
                                event.clientY > bounds.top + bounds.height / 2
                                  ? "after"
                                  : "before",
                            });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            const sourceId =
                              event.dataTransfer.getData(
                                "application/x-galgame-expression",
                              ) || draggedExpressionId;
                            if (sourceId) {
                              moveExpression(
                                sourceId,
                                expression.id,
                                event.clientY > bounds.top + bounds.height / 2
                                  ? "after"
                                  : "before",
                              );
                            }
                            setDraggedExpressionId(undefined);
                            setExpressionDropTarget(undefined);
                          }}
                          onDragEnd={() => {
                            setDraggedExpressionId(undefined);
                            setExpressionDropTarget(undefined);
                          }}
                        >
                          <span style={characterThumbnailCropStyle(expression)}>
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
                  <div className="galgame-expression-import-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({ mode: "add", source: "project" });
                        requestAnimationFrame(() => fileInput.current?.click());
                      }}
                    >
                      <Upload aria-hidden /> 批量导入
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPicker({ mode: "add", source: "library" })
                      }
                    >
                      <FolderOpen aria-hidden /> 文件库
                    </button>
                  </div>
                  {selectedExpression ? (
                    <CharacterExpressionForm model={model} />
                  ) : null}
                  <CharacterSkinPanel model={model} />
                  <footer>
                    <Check aria-hidden />
                    {expressions.length
                      ? "基准立绘已绑定 · 修改将在 650ms 后自动保存"
                      : "添加第一个表情后会自动设为默认立绘"}
                  </footer>
                </div>
              </div>
            ) : (
              <CharacterVoicePanel model={model} />
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

      <CharacterReferencePanel model={model} />

      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle="添加角色表情"
          replaceTitle="替换角色立绘"
          sequenceTitle="从项目素材添加序列帧"
          searchLabel="搜索立绘素材"
          projectEmptyCopy="上传图片后即可绑定为角色立绘。"
          onState={setPicker}
          onChoose={bindFile}
          onChooseMany={appendSequenceFiles}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmStaticMode}
        title="切换为静态图片？"
        description="切换后只保留当前序列的首帧，其余帧配置将从这个表情中移除。"
        confirmLabel="保留首帧并切换"
        onCancel={() => setConfirmStaticMode(false)}
        onConfirm={applyExpressionStaticMode}
      />
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
