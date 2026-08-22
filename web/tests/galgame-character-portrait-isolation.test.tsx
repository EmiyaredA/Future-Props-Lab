import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useMemo, useState } from "react";
import { vi } from "vitest";
import { CharacterWorkspaceView } from "@features/galgame-workshop/editor/CharacterWorkspaceView";
import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({ fileId }: { fileId?: string }) => (
    <span data-testid="portrait-file">{fileId ?? "missing"}</span>
  ),
}));

vi.mock("@features/galgame-workshop/editor/CharacterProfilePanel", () => ({
  CharacterProfilePanel: () => null,
}));
vi.mock("@features/galgame-workshop/editor/CharacterExpressionForm", () => ({
  CharacterExpressionForm: () => null,
}));
vi.mock("@features/galgame-workshop/editor/CharacterSkinPanel", () => ({
  CharacterSkinPanel: () => null,
}));
vi.mock("@features/galgame-workshop/editor/CharacterVoicePanel", () => ({
  CharacterVoicePanel: () => null,
}));
vi.mock("@features/galgame-workshop/editor/CharacterReferencePanel", () => ({
  CharacterReferencePanel: () => null,
}));

const characters: GalgameStoryCharacter[] = ["a", "b", "c"].map(
  (suffix, index) => ({
    id: `character-${suffix}`,
    name: `角色${["甲", "乙", "丙"][index]}`,
    description: "",
    expressions: [
      {
        // Imported projects can reuse an expression id in different characters.
        id: "expression-default",
        label: "默认",
        assetId: `portrait-${suffix}`,
      },
    ],
    defaultExpressionId: "expression-default",
  }),
);

const document: GalgameStoryProject = {
  schemaVersion: "1.4",
  synopsis: "",
  characters,
  scenes: [],
  variables: [],
  assets: ["a", "b", "c"].map((suffix) => ({
    id: `portrait-${suffix}`,
    type: "image",
    role: "characterPortrait",
    fileId: `file-${suffix}`,
    status: "ready",
  })),
  chapters: [],
};

function CharacterHarness() {
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    characters[0].id,
  );
  const [selectedExpressionId, setSelectedExpressionId] = useState<string>();
  const [selectedExpressionIds, setSelectedExpressionIds] = useState<
    Set<string>
  >(new Set());
  const [lastExpressionIndex, setLastExpressionIndex] = useState<number>();
  const [tab, setTab] = useState("expressions");
  const [workspaceMode, setWorkspaceMode] = useState("character");
  const selectedCharacter = characters.find(
    (character) => character.id === selectedCharacterId,
  )!;
  const expressions = selectedCharacter.expressions ?? [];
  const assetsById = useMemo(
    () => new Map((document.assets ?? []).map((asset) => [asset.id, asset])),
    [],
  );
  const noop = vi.fn();
  const model = {
    projectId: "project-1",
    document,
    onDocument: noop,
    onNotice: noop,
    fileInput: createRef<HTMLInputElement>(),
    voiceFileInput: createRef<HTMLInputElement>(),
    characters,
    query: "",
    setQuery: noop,
    selectedCharacter,
    setSelectedCharacterId,
    selectedExpressionId,
    setSelectedExpressionId,
    selectedExpressionIds,
    setSelectedExpressionIds,
    lastExpressionIndex,
    setLastExpressionIndex,
    draggedCharacterId: undefined,
    setDraggedCharacterId: noop,
    characterDropTarget: undefined,
    setCharacterDropTarget: noop,
    draggedExpressionId: undefined,
    setDraggedExpressionId: noop,
    expressionDropTarget: undefined,
    setExpressionDropTarget: noop,
    setSelectedDisplayNameId: noop,
    setSelectedSkinId: noop,
    tab,
    setTab,
    workspaceMode,
    setWorkspaceMode,
    stageScopeId: "global",
    selectStageScope: noop,
    setReferenceTab: noop,
    picker: undefined,
    setPicker: noop,
    confirmStaticMode: false,
    setConfirmStaticMode: noop,
    referencePanelOpen: false,
    setReferencePanelOpen: noop,
    uploadError: "",
    voicePickerOpen: false,
    setVoicePickerOpen: noop,
    voicePickerSource: "project",
    setVoicePickerSource: noop,
    expressions,
    selectedExpression: expressions.find(
      (expression) => expression.id === selectedExpressionId,
    ),
    references: [],
    expressionDetailLayout: true,
    assetsById,
    usedFileIds: new Set<string>(),
    filtered: characters,
    updateCharacter: noop,
    applyExpressionStaticMode: noop,
    appendSequenceFiles: noop,
    bindFile: noop,
    upload: { isPending: false, mutate: noop },
    batchUpload: { isPending: false, mutate: noop },
    sequenceBatchUpload: { isPending: false, mutate: noop },
    bindVoiceSample: noop,
    deleteSelectedExpressions: noop,
    moveCharacter: noop,
    moveCharacterByOffset: noop,
    moveExpression: noop,
    moveExpressionByOffset: noop,
    stageWorkspace: null,
    templatesWorkspace: null,
  };
  return <CharacterWorkspaceView model={model as never} />;
}

test("keeps every expression portrait scoped to the selected character", async () => {
  const user = userEvent.setup();
  render(<CharacterHarness />);

  const currentPortraits = () =>
    screen
      .getAllByTestId("portrait-file")
      .slice(-2)
      .map((portrait) => portrait.textContent);

  expect(currentPortraits()).toEqual(["file-a", "file-a"]);
  await user.click(
    screen.getByRole("button", { name: /角色乙 1 个表情 · 0 处引用/ }),
  );
  expect(currentPortraits()).toEqual(["file-b", "file-b"]);
  await user.click(
    screen.getByRole("button", { name: /角色丙 1 个表情 · 0 处引用/ }),
  );
  expect(currentPortraits()).toEqual(["file-c", "file-c"]);
  await user.click(
    screen.getByRole("button", { name: /角色甲 1 个表情 · 0 处引用/ }),
  );
  expect(currentPortraits()).toEqual(["file-a", "file-a"]);
});
