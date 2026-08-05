import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  firstChapter,
  fragmentById,
  scenePalette,
} from "@features/galgame-workshop/editor/model";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

type PlayerFrame =
  | { mode: "idle"; sceneId?: string; backgroundId?: string }
  | {
      mode: "content";
      fragmentId: string;
      blockIndex: number;
      block: GalgameStoryBlock;
      sceneId?: string;
      backgroundId?: string;
    }
  | { mode: "ending"; label: string; sceneId?: string; backgroundId?: string }
  | { mode: "error"; message: string; sceneId?: string; backgroundId?: string };

function nextFrame(
  document: GalgameStoryProject,
  fragmentId: string,
  blockIndex: number,
  initialSceneId?: string,
  initialBackgroundId?: string,
): PlayerFrame {
  const chapter = firstChapter(document);
  const currentFragmentId = fragmentId;
  let currentBlockIndex = blockIndex;
  let sceneId = initialSceneId;
  let backgroundId = initialBackgroundId;
  for (let steps = 0; steps < 100; steps += 1) {
    if (!chapter)
      return {
        mode: "error",
        message: "工程没有可试玩章节",
        sceneId,
        backgroundId,
      };
    const fragment = fragmentById(chapter, currentFragmentId);
    if (!fragment)
      return {
        mode: "error",
        message: "试玩线路引用了不存在的 Fragment",
        sceneId,
        backgroundId,
      };
    const block = (fragment.blocks ?? [])[currentBlockIndex];
    if (!block)
      return {
        mode: "error",
        message: "线路在没有结局的位置中断",
        sceneId,
        backgroundId,
      };
    if (block.type === "scene") {
      sceneId = block.sceneId;
      const scene = (document.scenes ?? []).find(
        (candidate) => candidate.id === sceneId,
      );
      backgroundId =
        block.backgroundId ?? scene?.defaultBackgroundId ?? undefined;
      currentBlockIndex += 1;
      continue;
    }
    if (block.type === "endChapter")
      return {
        mode: "ending",
        label: block.label,
        sceneId,
        backgroundId,
      };
    return {
      mode: "content",
      fragmentId: currentFragmentId,
      blockIndex: currentBlockIndex,
      block,
      sceneId,
      backgroundId,
    };
  }
  return {
    mode: "error",
    message: "线路执行超过安全步数，请检查循环",
    sceneId,
    backgroundId,
  };
}

export interface StoryPlayerHandle {
  restart: () => void;
}

export const StoryPlayer = forwardRef<
  StoryPlayerHandle,
  { document: GalgameStoryProject }
>(function StoryPlayer({ document }, ref) {
  const [frame, setFrame] = useState<PlayerFrame>({ mode: "idle" });
  const chapter = firstChapter(document);
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );
  const scenes = new Map(
    (document.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  const palette = useMemo(() => scenePalette(frame.sceneId), [frame.sceneId]);
  const activeDialogue =
    frame.mode === "content" && frame.block.type === "dialogue"
      ? frame.block
      : undefined;
  const activeCharacter = activeDialogue
    ? characters.get(activeDialogue.characterId)
    : undefined;
  const activeExpression = (activeCharacter?.expressions ?? []).find(
    (expression) =>
      expression.id ===
      (activeDialogue?.expressionId ?? activeCharacter?.defaultExpressionId),
  );
  const activeAsset = (document.assets ?? []).find(
    (asset) => asset.id === activeExpression?.assetId,
  );
  const activeScene = scenes.get(frame.sceneId ?? "");
  const activeBackground = (activeScene?.backgrounds ?? []).find(
    (background) => background.id === frame.backgroundId,
  );
  const activeBackgroundAsset = (document.assets ?? []).find(
    (asset) => asset.id === activeBackground?.assetId,
  );

  const restart = () => {
    if (!chapter) {
      setFrame({ mode: "error", message: "工程没有可试玩章节" });
      return;
    }
    setFrame(nextFrame(document, chapter.entryFragmentId, 0));
  };
  useImperativeHandle(ref, () => ({ restart }));
  const advance = () => {
    if (frame.mode !== "content") return;
    setFrame(
      nextFrame(
        document,
        frame.fragmentId,
        frame.blockIndex + 1,
        frame.sceneId,
        frame.backgroundId,
      ),
    );
  };

  return (
    <section className="galgame-player" aria-label="游戏预览">
      <header>
        <div>
          <strong>游戏预览</strong>
          <small>{scenes.get(frame.sceneId ?? "")?.name ?? "空舞台"}</small>
        </div>
        <button type="button" onClick={restart} aria-label="重新开始试玩">
          <RotateCcw aria-hidden />
        </button>
      </header>
      <div
        className="galgame-stage"
        style={{
          background: `radial-gradient(circle at 55% 25%, ${palette.first}, ${palette.second})`,
        }}
      >
        {activeBackgroundAsset ? (
          <StoryAssetImage
            fileId={activeBackgroundAsset.fileId}
            alt=""
            className="galgame-player-background"
            fallback={null}
          />
        ) : null}
        <span>{scenes.get(frame.sceneId ?? "")?.name ?? "等待场景 Block"}</span>
        {activeDialogue && activeCharacter ? (
          <div className="galgame-player-portrait" aria-hidden="true">
            <StoryAssetImage
              fileId={activeAsset?.fileId}
              alt=""
              className="galgame-player-portrait-image"
              fallback={
                <span className="galgame-player-portrait-fallback">
                  {activeCharacter.name.slice(0, 1) || "角"}
                </span>
              }
            />
          </div>
        ) : null}
        {frame.mode === "idle" ? (
          <button
            className="galgame-player-start"
            type="button"
            onClick={restart}
          >
            <Play aria-hidden /> 开始试玩
          </button>
        ) : frame.mode === "ending" ? (
          <div className="galgame-ending">
            <small>ENDING</small>
            <strong>{frame.label}</strong>
            <button type="button" onClick={restart}>
              重新开始
            </button>
          </div>
        ) : frame.mode === "error" ? (
          <div className="galgame-player-error" role="alert">
            <strong>试玩已停止</strong>
            <span>{frame.message}</span>
            <button type="button" onClick={restart}>
              重新开始
            </button>
          </div>
        ) : frame.block.type === "branch" ? (
          <div className="galgame-choices">
            <strong>{frame.block.prompt || "请选择"}</strong>
            {frame.block.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() =>
                  setFrame(
                    nextFrame(
                      document,
                      choice.targetFragmentId,
                      0,
                      frame.sceneId,
                      frame.backgroundId,
                    ),
                  )
                }
              >
                {choice.text || "未命名选项"}
              </button>
            ))}
          </div>
        ) : frame.block.type === "dialogue" ||
          frame.block.type === "narration" ? (
          <button
            className="galgame-dialogue-box"
            type="button"
            onClick={advance}
          >
            {frame.block.type === "dialogue" ? (
              <strong>
                {characters.get(frame.block.characterId)?.name ?? "未知角色"}
              </strong>
            ) : (
              <small>旁白</small>
            )}
            <span>{frame.block.text || "（空正文）"}</span>
            <em>点击继续</em>
          </button>
        ) : null}
      </div>
    </section>
  );
});
