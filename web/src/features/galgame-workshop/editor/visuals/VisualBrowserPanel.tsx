import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  ImagePlus,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { stableId } from "@features/galgame-workshop/editor/model";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";
import { VisualBrowserItem } from "@features/galgame-workshop/editor/visuals/VisualBrowserItem";

type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualBrowserPanel({
  model,
}: {
  model: VisualWorkspaceViewModel;
}) {
  const {
    document,
    onDocument,
    draggedItem,
    scenes,
    cgs,
    groups,
    query,
    setQuery,
    rootsOpen,
    setRootsOpen,
    visibleScenes,
    visibleCgs,
    createScene,
    createCg,
    moveScene,
  } = model;
  return (
    <>
      <aside className="galgame-visual-browser">
        <div className="galgame-visual-browser-toolbar">
          <label>
            <Search aria-hidden />
            <input
              aria-label="搜索场景和 CG"
              value={query}
              placeholder="搜索场景或 CG…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" aria-label="新建场景" onClick={createScene}>
            <ImagePlus aria-hidden />
          </button>
          <button type="button" aria-label="新建 CG" onClick={createCg}>
            <Plus aria-hidden />
          </button>
          <button
            type="button"
            aria-label="添加分组"
            onClick={() => {
              const group = {
                id: stableId(),
                name: `新分组 ${groups.length + 1}`,
                color: "#7586E5",
                collapsed: false,
              };
              onDocument({
                ...document,
                sceneGroups: [...groups, group],
              });
            }}
          >
            <FolderOpen aria-hidden />
          </button>
        </div>

        <div className="galgame-visual-browser-tree">
          <section>
            <button
              type="button"
              className="galgame-visual-tree-root"
              aria-expanded={rootsOpen.scenes}
              onClick={() =>
                setRootsOpen((current) => ({
                  ...current,
                  scenes: !current.scenes,
                }))
              }
            >
              {rootsOpen.scenes ? (
                <ChevronDown aria-hidden />
              ) : (
                <ChevronRight aria-hidden />
              )}
              <span>场景</span>
              <em>{scenes.filter((scene) => !scene.groupId).length}</em>
            </button>
            {rootsOpen.scenes
              ? visibleScenes
                  .filter((scene) => !scene.groupId)
                  .map((scene) => (
                    <VisualBrowserItem
                      key={scene.id}
                      model={model}
                      item={{ kind: "scene", id: scene.id }}
                    />
                  ))
              : null}
          </section>

          <section>
            <button
              type="button"
              className="galgame-visual-tree-root"
              aria-label="剧情 CG"
              aria-expanded={rootsOpen.cgs}
              onClick={() =>
                setRootsOpen((current) => ({
                  ...current,
                  cgs: !current.cgs,
                }))
              }
            >
              {rootsOpen.cgs ? (
                <ChevronDown aria-hidden />
              ) : (
                <ChevronRight aria-hidden />
              )}
              <span>CG</span>
              <em>{cgs.length}</em>
            </button>
            {rootsOpen.cgs
              ? visibleCgs.map((cg) => (
                  <VisualBrowserItem
                    key={cg.id}
                    model={model}
                    item={{ kind: "cg", id: cg.id }}
                  />
                ))
              : null}
          </section>

          {groups.map((group) => {
            const groupScenes = scenes.filter(
              (scene) => scene.groupId === group.id,
            );
            const groupedScenes = visibleScenes.filter(
              (scene) => scene.groupId === group.id,
            );
            return (
              <section
                key={group.id}
                className="galgame-visual-custom-group"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dragged = draggedItem.current;
                  if (dragged?.kind === "scene")
                    moveScene(dragged.id, undefined, group.id);
                  draggedItem.current = undefined;
                }}
              >
                <div className="galgame-visual-tree-root">
                  <button
                    type="button"
                    aria-label={`${group.collapsed ? "展开" : "折叠"}${group.name}`}
                    onClick={() =>
                      onDocument({
                        ...document,
                        sceneGroups: groups.map((candidate) =>
                          candidate.id === group.id
                            ? {
                                ...candidate,
                                collapsed: !candidate.collapsed,
                              }
                            : candidate,
                        ),
                      })
                    }
                  >
                    {group.collapsed ? (
                      <ChevronRight aria-hidden />
                    ) : (
                      <ChevronDown aria-hidden />
                    )}
                  </button>
                  <i style={{ background: group.color }} />
                  <input
                    aria-label="分组名称"
                    value={group.name}
                    onChange={(event) =>
                      onDocument({
                        ...document,
                        sceneGroups: groups.map((candidate) =>
                          candidate.id === group.id
                            ? { ...candidate, name: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                  <em>{groupScenes.length}</em>
                  <button
                    type="button"
                    aria-label={`删除分组 ${group.name}`}
                    onClick={() =>
                      onDocument({
                        ...document,
                        sceneGroups: groups.filter(
                          (candidate) => candidate.id !== group.id,
                        ),
                        scenes: scenes.map((scene) =>
                          scene.groupId === group.id
                            ? { ...scene, groupId: null }
                            : scene,
                        ),
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
                {!group.collapsed
                  ? groupedScenes.map((scene) => (
                      <VisualBrowserItem
                        key={scene.id}
                        model={model}
                        item={{ kind: "scene", id: scene.id }}
                      />
                    ))
                  : null}
              </section>
            );
          })}

          {!visibleScenes.length && !visibleCgs.length ? (
            <p className="galgame-visual-tree-empty">
              {query ? "没有匹配的场景或 CG。" : "创建第一个场景或 CG。"}
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
