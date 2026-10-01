import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
import type {
  PetConfig,
  PetDocument,
  PetProject,
} from "../src/features/desktop-pet/api";
import { EditorPage } from "../src/features/desktop-pet/EditorPage";

const state = vi.hoisted(() => ({
  document: null as PetDocument | null,
  save: vi.fn(),
}));

vi.mock("../src/features/desktop-pet/PetRenderer", () => ({
  PetRenderer: () => <div data-testid="pet-preview" />,
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  getProject: async () =>
    ({
      id: "pet-1",
      title: "测试桌宠",
      revision: state.document?.revision ?? 0,
      sourceProjectId: "source-1",
      sourceRevision: 1,
      sourceTitle: "测试角色",
      createdAt: "2026-09-30T00:00:00Z",
      updatedAt: "2026-09-30T00:00:00Z",
    }) satisfies PetProject,
  getDocument: async () => structuredClone(state.document),
  saveDocument: async (
    _id: string,
    expectedRevision: number,
    config: PetConfig,
  ) => {
    state.save(expectedRevision, config);
    state.document = {
      ...state.document!,
      revision: expectedRevision + 1,
      config,
    };
    return structuredClone(state.document);
  },
  syncSource: vi.fn(),
  uploadSkin: vi.fn(),
}));

beforeEach(() => {
  state.document = {
    revision: 0,
    sourceRevision: 1,
    character: fixture.document as PetDocument["character"],
    config: {
      schemaVersion: 1,
      skins: [],
      activeSkinId: null,
      events: {},
      habits: {
        roam: "calm",
        size: 220,
        draggable: true,
        bubbles: true,
        sound: true,
        hoverActions: ["dress", "roam", "hide"],
      },
    },
    assetUrls: {},
  };
  state.save.mockClear();
});

test("keyboard-created skin and click reaction survive a save and reopen", async () => {
  const user = userEvent.setup();
  const first = render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByText("形象与皮肤");
  const name = screen.getByRole("textbox", { name: "新皮肤名称" });
  await user.type(name, "秋日外套{Enter}");
  expect(screen.getByRole("button", { name: "秋日外套" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(state.save).toHaveBeenCalled());
  expect(state.document?.config.activeSkinId).toBeTruthy();

  const eventsTab = screen.getByRole("button", { name: /^交互$/ });
  eventsTab.focus();
  await user.keyboard("{Enter}");
  expect(eventsTab).toHaveAttribute("aria-pressed", "true");
  await user.type(screen.getByRole("textbox", { name: "气泡文案" }), "你好呀");
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  first.unmount();

  render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByRole("button", { name: "秋日外套" });
  await user.click(screen.getByRole("button", { name: /^交互$/ }));
  expect(screen.getByRole("textbox", { name: "气泡文案" })).toHaveValue(
    "你好呀",
  );
  expect(screen.getByTestId("pet-preview")).toBeInTheDocument();
});
