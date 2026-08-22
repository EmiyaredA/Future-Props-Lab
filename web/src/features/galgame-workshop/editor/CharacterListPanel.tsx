import { ChevronRight, Plus, Search, SlidersHorizontal } from "lucide-react";
import { stableId } from "@features/galgame-workshop/editor/model";
import { CharacterAvatar } from "@features/galgame-workshop/editor/CharacterAvatar";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/characterWorkspaceViewModel";
import {
  CHARACTER_PALETTE,
  referencesForCharacter,
} from "@features/galgame-workshop/editor/characterWorkspacePresentation";
export function CharacterListPanel({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    document,
    onDocument,
    characters,
    query,
    setQuery,
    setSelectedCharacterId,
    setSelectedExpressionId,
    setSelectedExpressionIds,
    setLastExpressionIndex,
    draggedCharacterId,
    setDraggedCharacterId,
    characterDropTarget,
    setCharacterDropTarget,
    setSelectedDisplayNameId,
    setSelectedSkinId,
    setTab,
    workspaceMode,
    setWorkspaceMode,
    stageScopeId,
    selectedCharacter,
    filtered,
    selectStageScope,
    moveCharacter,
    moveCharacterByOffset,
  } = model;
  return (
    <aside className="galgame-character-list-panel">
      <section className="galgame-character-global-navigation">
        <small>全局设置</small>
        <button
          type="button"
          className={workspaceMode === "stage" ? "active" : ""}
          onClick={() => {
            if (stageScopeId !== "global" && selectedCharacter)
              selectStageScope(selectedCharacter.id);
            setWorkspaceMode("stage");
          }}
        >
          <SlidersHorizontal aria-hidden />
          <span>位置与尺寸</span>
        </button>
        <button
          type="button"
          className={workspaceMode === "templates" ? "active" : ""}
          onClick={() => setWorkspaceMode("templates")}
        >
          <span aria-hidden>#</span>
          <span>属性模板</span>
        </button>
      </section>
      <header className="galgame-character-list-heading">
        <span>
          <strong>角色列表</strong>
          <em>
            {characters.length} 个角色 ·{" "}
            {characters.reduce(
              (count, character) =>
                count + (character.expressions?.length ?? 0),
              0,
            )}{" "}
            个表情
          </em>
        </span>
        <button
          type="button"
          aria-label="新建角色"
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
                  themeColor:
                    CHARACTER_PALETTE[
                      characters.length % CHARACTER_PALETTE.length
                    ],
                  expressions: [],
                  defaultExpressionId: null,
                  attributes: Object.fromEntries(
                    (document.characterAttributeTemplates ?? []).map(
                      (attribute) => [attribute.id, attribute.defaultValue],
                    ),
                  ),
                },
              ],
            });
            setSelectedCharacterId(id);
            setSelectedExpressionId(undefined);
            setSelectedExpressionIds(new Set());
            setLastExpressionIndex(undefined);
            setSelectedDisplayNameId("main");
            setSelectedSkinId(undefined);
            setWorkspaceMode("character");
            setTab("expressions");
          }}
        >
          <Plus aria-hidden />
        </button>
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
      <div className="galgame-character-list">
        {filtered.map((character) => {
          const count = referencesForCharacter(document, character.id).length;
          return (
            <button
              key={character.id}
              type="button"
              draggable
              aria-roledescription="可排序角色卡片"
              title="拖动调整角色顺序；Alt+↑/↓ 也可移动"
              className={[
                character.id === selectedCharacter?.id ? "active" : "",
                draggedCharacterId === character.id ? "is-dragging" : "",
                characterDropTarget?.id === character.id
                  ? `is-drop-${characterDropTarget.placement}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  "--character-theme": character.themeColor ?? "#E75B55",
                } as CSSProperties
              }
              onClick={() => {
                setSelectedCharacterId(character.id);
                setSelectedExpressionId(undefined);
                setSelectedExpressionIds(new Set());
                setLastExpressionIndex(undefined);
                setSelectedDisplayNameId("main");
                setSelectedSkinId(undefined);
                setWorkspaceMode("character");
                setTab("expressions");
              }}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                  return;
                event.preventDefault();
                moveCharacterByOffset(
                  character.id,
                  event.key === "ArrowUp" ? -1 : 1,
                );
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-galgame-character",
                  character.id,
                );
                event.dataTransfer.setData("text/plain", character.id);
                setDraggedCharacterId(character.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setCharacterDropTarget({
                  id: character.id,
                  placement:
                    event.clientY > bounds.top + bounds.height / 2
                      ? "after"
                      : "before",
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const sourceId =
                  event.dataTransfer.getData(
                    "application/x-galgame-character",
                  ) || draggedCharacterId;
                if (sourceId) {
                  moveCharacter(
                    sourceId,
                    character.id,
                    event.clientY > bounds.top + bounds.height / 2
                      ? "after"
                      : "before",
                  );
                }
                setDraggedCharacterId(undefined);
                setCharacterDropTarget(undefined);
              }}
              onDragEnd={() => {
                setDraggedCharacterId(undefined);
                setCharacterDropTarget(undefined);
              }}
            >
              <CharacterAvatar character={character} document={document} />
              <span>
                <strong>{character.name}</strong>
                <small>
                  {character.expressions?.length ?? 0} 个表情 · {count} 处引用
                </small>
              </span>
              <ChevronRight aria-hidden />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
import type { CSSProperties } from "react";
