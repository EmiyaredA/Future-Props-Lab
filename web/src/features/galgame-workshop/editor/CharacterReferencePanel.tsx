import { Eye, EyeOff, LocateFixed, Trash2, UserRound, X } from "lucide-react";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/CharacterWorkspaceView";
export function CharacterReferencePanel({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    document,
    onLocate,
    referenceTab,
    setReferenceTab,
    previewEnabled,
    setPreviewEnabled,
    previewBackgroundMode,
    setPreviewBackgroundMode,
    previewSceneId,
    setPreviewSceneId,
    setPreviewPositionId,
    setNaturalPortraitSizes,
    referencePanelOpen,
    setReferencePanelOpen,
    selectedCharacter,
    previewExpression,
    previewSkinAssetId,
    references,
    expressionDetailLayout,
    fragmentCount,
    assetsById,
    deleteCharacter,
    previewResolvedAsset,
    previewBackgroundAsset,
    stageSettings,
    previewPosition,
    footprintHeight,
    footprintWidth,
  } = model;
  return (
    <aside
      className={`galgame-character-reference-panel ${
        expressionDetailLayout ? "is-drawer" : ""
      } ${referencePanelOpen ? "is-open" : ""}`}
    >
      <nav aria-label="角色预览与资源引用">
        <button
          type="button"
          className={referenceTab === "preview" ? "active" : ""}
          onClick={() => setReferenceTab("preview")}
        >
          角色预览
        </button>
        <button
          type="button"
          className={referenceTab === "references" ? "active" : ""}
          onClick={() => setReferenceTab("references")}
        >
          资源引用 <em>{references.length}</em>
        </button>
        {expressionDetailLayout ? (
          <button
            type="button"
            className="galgame-character-reference-close"
            aria-label="关闭资源引用"
            onClick={() => setReferencePanelOpen(false)}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </nav>
      {referenceTab === "preview" ? (
        <section className="galgame-character-live-preview">
          <header>
            <button
              type="button"
              className={previewEnabled ? "active" : ""}
              onClick={() => setPreviewEnabled((current) => !current)}
            >
              {previewEnabled ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              实时预览
            </button>
            <small>
              {document.settings?.canvas?.width ?? 1920} ×{" "}
              {document.settings?.canvas?.height ?? 1080}
            </small>
          </header>
          <p>当前角色 + 默认表情 · 仅影响预览</p>
          <div
            className={`galgame-character-preview-stage is-${previewBackgroundMode}`}
          >
            {previewBackgroundMode === "scene" ? (
              <StoryAssetImage
                fileId={previewBackgroundAsset?.fileId}
                alt=""
                fallback={<span />}
              />
            ) : null}
            {previewEnabled ? (
              <span
                className="galgame-character-preview-actor"
                style={{
                  left: `${previewPosition.x}%`,
                  top: `${previewPosition.y}%`,
                  width: `${footprintWidth}%`,
                  height: `${footprintHeight}%`,
                  transform: `${
                    stageSettings.anchor === "center"
                      ? "translate(-50%, -50%)"
                      : "translate(0, 0)"
                  } scaleX(${previewExpression?.flipX ? -1 : 1})`,
                }}
              >
                <ExpressionPortrait
                  expression={previewExpression}
                  assets={document.assets ?? []}
                  skinAssetId={previewSkinAssetId}
                  alt={selectedCharacter?.name ?? "角色预览"}
                  fallback={<UserRound aria-hidden />}
                  onNaturalSize={({ width, height }) => {
                    if (!previewResolvedAsset?.fileId) return;
                    const fileId = previewResolvedAsset.fileId;
                    setNaturalPortraitSizes((current) => {
                      const existing = current.get(fileId);
                      if (
                        existing?.width === width &&
                        existing.height === height
                      )
                        return current;
                      const next = new Map(current);
                      next.set(fileId, { width, height });
                      return next;
                    });
                  }}
                />
                {(previewExpression?.overlays ?? []).map((overlay) => {
                  const overlayAsset = assetsById.get(overlay.assetId);
                  return overlayAsset?.type === "image" ? (
                    <StoryAssetImage
                      key={overlay.id}
                      fileId={overlayAsset.fileId}
                      alt=""
                      className="galgame-character-preview-overlay"
                      style={{
                        left: `${overlay.x}%`,
                        top: `${overlay.y}%`,
                        width: `${overlay.width}%`,
                        opacity: overlay.opacity,
                      }}
                      fallback={null}
                    />
                  ) : null;
                })}
              </span>
            ) : null}
          </div>
          <div className="galgame-character-preview-backgrounds">
            {(
              [
                ["scene", "背景图"],
                ["dark", "深色"],
                ["light", "浅色"],
                ["checkerboard", "棋盘"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={previewBackgroundMode === mode ? "active" : ""}
                onClick={() => setPreviewBackgroundMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            <span>背景</span>
            <CustomSelect
              ariaLabel="角色预览背景"
              value={previewSceneId}
              onChange={setPreviewSceneId}
              disabled={previewBackgroundMode !== "scene"}
              options={[
                { value: "", label: "棋盘背景" },
                ...(document.scenes ?? []).map((scene) => ({
                  value: scene.id,
                  label: scene.name,
                })),
              ]}
            />
          </label>
          <div className="galgame-character-preview-position-heading">
            <strong>位置</strong>
            <small>
              {previewPosition.name} · {previewPosition.x}，{previewPosition.y}
            </small>
          </div>
          <div
            className="galgame-character-position-pills"
            aria-label="预览站位"
          >
            {stageSettings.positionPresets.map((position) => (
              <button
                key={position.id}
                type="button"
                className={previewPosition.id === position.id ? "active" : ""}
                onClick={() => setPreviewPositionId(position.id)}
              >
                {position.name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="galgame-character-reference-content">
          <header>
            <strong>引用位置</strong>
            <small>{references.length} 处</small>
          </header>
          <div className="galgame-character-reference-metrics">
            <span>
              <strong>{references.length}</strong>
              <small>处引用</small>
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
                    {reference.blockIndex + 1} ·{" "}
                    {reference.kind === "dialogue"
                      ? "Dialogue"
                      : reference.kind === "showCharacter"
                        ? "角色登场"
                        : reference.kind === "setStageCast"
                          ? "舞台构图"
                          : "角色退场"}
                  </strong>
                  <small>{reference.text || "（空对白）"}</small>
                </span>
                <LocateFixed aria-hidden />
              </button>
            ))}
            {!references.length ? <p>这个角色还没有被剧本引用。</p> : null}
          </div>
        </section>
      )}
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
  );
}
