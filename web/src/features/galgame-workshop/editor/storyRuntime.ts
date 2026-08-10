import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  applyAutomaticStageBlock,
  emptyStageState,
  enterContentBlock,
  type GalgameStageState,
} from "@features/galgame-workshop/editor/stage";
import {
  chapterById,
  entryChapter,
  fragmentById,
} from "@features/galgame-workshop/editor/model";
import {
  evaluateStoryExpression,
  type StoryScalar,
} from "@features/galgame-workshop/editor/storyExpression";

export type StoryReturnCursor = {
  chapterId: string;
  fragmentId: string;
  blockIndex: number;
};
export type StoryRuntimeState = StoryReturnCursor & {
  callStack: StoryReturnCursor[];
  variables: Record<string, StoryScalar>;
  stage: GalgameStageState;
  paragraph: {
    textSpeedCps: number;
    fadeMs: number;
    revealEffect: "typewriter" | "fade" | "instant";
    readBehavior: "inherit" | "dim" | "keep";
    historyLimit: number;
    styleRef: {
      source: "builtin" | "project" | "extension";
      id: string;
    };
  };
};

export type StoryRuntimeResult =
  | {
      kind: "content" | "choice";
      state: StoryRuntimeState;
      block: GalgameStoryBlock;
      effects: GalgameStoryBlock[];
    }
  | {
      kind: "stopped";
      state: StoryRuntimeState;
      label: string;
      effects: GalgameStoryBlock[];
    }
  | {
      kind: "error";
      state: StoryRuntimeState;
      message: string;
      effects: GalgameStoryBlock[];
    };

export function initialRuntime(
  document: GalgameStoryProject,
): StoryRuntimeState {
  const chapter = entryChapter(document);
  return {
    chapterId: chapter?.id ?? "",
    fragmentId: chapter?.entryFragmentId ?? "",
    blockIndex: 0,
    callStack: [],
    variables: Object.fromEntries(
      (document.variables ?? []).map((variable) => [
        variable.id,
        variable.defaultValue,
      ]),
    ),
    stage: emptyStageState(),
    paragraph: {
      textSpeedCps: document.presentation?.text?.defaultSpeedCps ?? 40,
      fadeMs: 0,
      revealEffect: "typewriter",
      readBehavior: "inherit",
      historyLimit: 0,
      styleRef: document.presentation?.paragraph?.defaultStyleRef ?? {
        source: "builtin",
        id: "classic",
      },
    },
  };
}

function expressionValues(
  document: GalgameStoryProject,
  state: StoryRuntimeState,
) {
  const values = { ...state.variables };
  for (const character of document.characters ?? [])
    for (const [attributeId, value] of Object.entries(
      character.attributes ?? {},
    ))
      values[`character.${character.id}.${attributeId}`] = value;
  return values;
}

function call(
  state: StoryRuntimeState,
  targetFragmentId: string,
): StoryRuntimeState {
  return {
    ...state,
    callStack: [
      ...state.callStack,
      {
        chapterId: state.chapterId,
        fragmentId: state.fragmentId,
        blockIndex: state.blockIndex + 1,
      },
    ],
    fragmentId: targetFragmentId,
    blockIndex: 0,
  };
}

export function chooseRuntimeFragment(
  document: GalgameStoryProject,
  state: StoryRuntimeState,
  targetFragmentId: string,
) {
  const chapter = chapterById(document, state.chapterId);
  if (!chapter || !fragmentById(chapter, targetFragmentId)) return state;
  return call(state, targetFragmentId);
}

export function advanceRuntime(
  document: GalgameStoryProject,
  source: StoryRuntimeState,
): StoryRuntimeResult {
  let state = source;
  const effects: GalgameStoryBlock[] = [];
  for (let step = 0; step < 1000; step += 1) {
    const chapter = chapterById(document, state.chapterId);
    const fragment = chapter
      ? fragmentById(chapter, state.fragmentId)
      : undefined;
    if (!chapter || !fragment)
      return {
        kind: "error",
        state,
        effects,
        message: "试玩线路引用了不存在的章节或 Fragment",
      };
    const block = fragment.blocks?.[state.blockIndex];
    if (!block) {
      const returned = state.callStack.at(-1);
      if (returned) {
        state = {
          ...state,
          ...returned,
          callStack: state.callStack.slice(0, -1),
        };
        continue;
      }
      return { kind: "stopped", state, effects, label: "故事结束" };
    }
    if (
      [
        "scene",
        "showCg",
        "hideCg",
        "showCharacter",
        "removeCharacter",
        "destroyScene",
        "camera",
        "resetCamera",
        "particle",
        "stageAnimation",
        "floatingText",
        "curtain",
        "video",
        "animateSprite",
        "autoPlay",
        "switchDialogueStyle",
        "portraitStyleRule",
      ].includes(block.type)
    ) {
      const waitForCompletion =
        "waitForCompletion" in block && block.waitForCompletion === true;
      state = {
        ...state,
        stage: applyAutomaticStageBlock(state.stage, block, document),
        blockIndex: waitForCompletion ? state.blockIndex : state.blockIndex + 1,
      };
      effects.push(block);
      if (waitForCompletion) return { kind: "content", state, block, effects };
      continue;
    }
    if (block.type === "audio" || block.type === "gallery") {
      effects.push(block);
      state = { ...state, blockIndex: state.blockIndex + 1 };
      continue;
    }
    if (block.type === "comment") {
      state = { ...state, blockIndex: state.blockIndex + 1 };
      continue;
    }
    if (block.type === "paragraphParams") {
      state = {
        ...state,
        paragraph: {
          ...state.paragraph,
          ...(block.textSpeedCps != null
            ? {
                textSpeedCps:
                  block.textSpeedCps ||
                  document.presentation?.text?.defaultSpeedCps ||
                  40,
              }
            : {}),
          ...(block.fadeMs != null ? { fadeMs: block.fadeMs } : {}),
          ...(block.revealEffect ? { revealEffect: block.revealEffect } : {}),
          ...(block.readBehavior ? { readBehavior: block.readBehavior } : {}),
          ...(block.historyLimit != null
            ? { historyLimit: block.historyLimit }
            : {}),
          ...(block.styleRef ? { styleRef: block.styleRef } : {}),
        },
        blockIndex: state.blockIndex + 1,
      };
      continue;
    }
    if (block.type === "setVariable") {
      const current = state.variables[block.variableId];
      let value = block.value as StoryScalar;
      if (block.operator === "toggle") value = !current;
      else if (typeof current === "number" && typeof value === "number") {
        if (block.operator === "add") value = current + value;
        if (block.operator === "subtract") value = current - value;
        if (block.operator === "multiply") value = current * value;
        if (block.operator === "divide")
          value = value === 0 ? current : current / value;
      }
      state = {
        ...state,
        variables: { ...state.variables, [block.variableId]: value },
        blockIndex: state.blockIndex + 1,
      };
      continue;
    }
    if (block.type === "callFragment") {
      state = call(state, block.targetFragmentId);
      continue;
    }
    if (block.type === "if") {
      try {
        const target = evaluateStoryExpression(
          block.condition,
          expressionValues(document, state),
        )
          ? block.thenFragmentId
          : block.elseFragmentId;
        state = target
          ? call(state, target)
          : { ...state, blockIndex: state.blockIndex + 1 };
        continue;
      } catch (error) {
        return {
          kind: "error",
          state,
          effects,
          message: error instanceof Error ? error.message : "条件表达式无效",
        };
      }
    }
    if (block.type === "endChapter") {
      const enabled = [...(document.chapters ?? [])]
        .filter((item) => !item.disabled)
        .sort((a, b) => a.order - b.order);
      const currentIndex = enabled.findIndex((item) => item.id === chapter.id);
      const next = enabled[currentIndex + 1];
      if (!next)
        return {
          kind: "stopped",
          state,
          effects,
          label: block.label || "故事结束",
        };
      state = {
        ...state,
        chapterId: next.id,
        fragmentId: next.entryFragmentId,
        blockIndex: 0,
        callStack: [],
      };
      continue;
    }
    if (block.type === "returnToEntry") {
      effects.push(block);
      state = initialRuntime(document);
      continue;
    }
    const stage = enterContentBlock(state.stage, block, document);
    state = { ...state, stage };
    return {
      kind: block.type === "branch" ? "choice" : "content",
      state,
      block,
      effects,
    };
  }
  return {
    kind: "error",
    state,
    effects,
    message: "线路执行超过安全步数，请检查无出口递归",
  };
}

export function continueRuntime(
  document: GalgameStoryProject,
  state: StoryRuntimeState,
) {
  return advanceRuntime(document, {
    ...state,
    blockIndex: state.blockIndex + 1,
  });
}

export function continueRuntimeWithVariable(
  document: GalgameStoryProject,
  state: StoryRuntimeState,
  variableId: string | null | undefined,
  value: boolean,
) {
  return continueRuntime(document, {
    ...state,
    variables: variableId
      ? { ...state.variables, [variableId]: value }
      : state.variables,
  });
}
