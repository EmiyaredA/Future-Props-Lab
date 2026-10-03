import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
import type {
  PetConfig,
  PetDocument,
  PetProject,
} from "../src/features/desktop-pet/api";
import { EditorPage } from "../src/features/desktop-pet/EditorPage";
import { ApiError } from "../src/platform/api/client";

const state = vi.hoisted(() => ({
  document: null as PetDocument | null,
  save: vi.fn(),
  preview: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("../src/features/desktop-pet/PetRenderer", () => ({
  PetRenderer: (props: {
    eventName: string;
    reactionKey: number;
    playbackMode: string;
  }) => {
    state.preview(props);
    return (
      <div
        data-testid="pet-preview"
        data-event={props.eventName}
        data-key={props.reactionKey}
        data-mode={props.playbackMode}
      />
    );
  },
}));
vi.mock("../src/features/desktop-pet/WhaleRenderer", () => ({
  WhaleRenderer: (props: { motionDemo?: string }) => (
    <div data-testid="whale-preview" data-motion-demo={props.motionDemo} />
  ),
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  getProject: async () =>
    ({
      id: "pet-1",
      title: "测试桌宠",
      revision: state.document?.revision ?? 0,
      sourceProjectId: "source-1",
      sourceType: "live2d",
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
  replacePackage: (...args: unknown[]) => state.replace(...args),
}));

test("package replacement keeps the draft on conflict and exposes newly loaded outfits", async () => {
  state.document = {
    ...state.document!,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      rigProfile: "human-chibi",
      character: { name: "牧濑红莉栖" },
      schemes: [
        { id: "kurisu-classic", brand: "牧濑红莉栖", label: "经典便服" },
      ],
    },
    whaleAssets: {},
    config: { ...state.document!.config, schemeId: "kurisu-classic" },
  };
  state.replace.mockRejectedValueOnce(
    new ApiError(
      "版本冲突，保留当前素材",
      { title: "Conflict", status: 409 },
      409,
    ),
  );
  state.replace.mockImplementationOnce(async () => {
    state.document = {
      ...state.document!,
      revision: 1,
      whaleModel: {
        ...state.document!.whaleModel,
        schemes: [
          { id: "kurisu-classic", brand: "牧濑红莉栖", label: "经典便服" },
          { id: "kurisu-lab", brand: "牧濑红莉栖", label: "实验室服" },
        ],
      },
    };
    return structuredClone(state.document);
  });
  render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByRole("button", { name: "更新角色资源包" });
  const file = new File(["zip"], "wardrobe.zip", { type: "application/zip" });
  const input = screen.getByLabelText("选择更新角色资源包");
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
  expect(screen.getByRole("button", { name: "载入最新版本" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "牧濑红莉栖 · 经典便服" }),
  ).toBeVisible();
  fireEvent.change(input, { target: { files: [file] } });
  expect(
    await screen.findByRole("button", { name: "牧濑红莉栖 · 实验室服" }),
  ).toBeVisible();
  expect(state.replace).toHaveBeenLastCalledWith("pet-1", 0, file);
  expect(state.save).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "牧濑红莉栖 · 实验室服" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "设为桌宠默认配色" }),
  );
  expect(screen.getByRole("button", { name: "更新角色资源包" })).toBeDisabled();
  expect(screen.getByText("请先保存当前修改")).toBeVisible();
});

beforeEach(() => {
  state.replace.mockReset();
  state.document = {
    revision: 0,
    sourceType: "live2d",
    sourceRevision: 1,
    character: fixture.document as PetDocument["character"],
    whaleModel: null,
    whaleAssets: null,
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      events: {},
      habits: {
        roam: "calm",
        size: 220,
        draggable: true,
        edgeClimbing: true,
        highGliding: true,
        bubbles: true,
        sound: true,
        hoverActions: ["dress", "roam", "hide"],
      },
    },
    assetUrls: {},
  };
  state.save.mockClear();
});

test("keyboard-created skin, lines, and persona survive a save and reopen", async () => {
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
  await user.click(screen.getByRole("button", { name: /^台词$/ }));
  await user.click(screen.getByRole("button", { name: /添加台词/ }));
  await user.type(
    screen.getByRole("textbox", { name: "第 1 句台词" }),
    "你好呀",
  );
  await user.click(screen.getByRole("button", { name: /^聊天$/ }));
  await user.type(screen.getByRole("textbox", { name: "性格" }), "好奇而温柔");
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  first.unmount();

  render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByRole("button", { name: "秋日外套" });
  await user.click(screen.getByRole("button", { name: /^台词$/ }));
  expect(screen.getByRole("textbox", { name: "第 1 句台词" })).toHaveValue(
    "你好呀",
  );
  await user.click(screen.getByRole("button", { name: /^聊天$/ }));
  expect(screen.getByRole("textbox", { name: "性格" })).toHaveValue(
    "好奇而温柔",
  );
  expect(screen.getByTestId("pet-preview")).toBeInTheDocument();
});

test("left selection and right edits immediately preview; opening a menu does not restart playback", async () => {
  const user = userEvent.setup();
  render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByText("形象与皮肤");
  await user.click(screen.getByRole("button", { name: /^交互$/ }));
  await user.click(screen.getByRole("button", { name: /点击身体/ }));
  const preview = screen.getByTestId("pet-preview");
  expect(preview).toHaveAttribute("data-event", "click");
  const key = preview.getAttribute("data-key");
  await user.click(screen.getByRole("button", { name: "动作" }));
  expect(preview).toHaveAttribute("data-key", key);
  await user.click(
    screen.getByRole("menuitemradio", {
      name: fixture.document.motions[0].name,
    }),
  );
  expect(preview.getAttribute("data-key")).not.toBe(key);
  expect(state.preview.mock.lastCall?.[0].playbackMode).toBe("inspect");
  const newKey = preview.getAttribute("data-key");
  await user.click(screen.getByRole("button", { name: "表情" }));
  expect(preview).toHaveAttribute("data-key", newKey);
  await user.click(
    screen.getByRole("menuitemradio", {
      name: fixture.document.expressions[0].name,
    }),
  );
  expect(preview.getAttribute("data-key")).not.toBe(newKey);
  await user.click(screen.getByRole("button", { name: /播放事件/ }));
  expect(preview).toHaveAttribute("data-mode", "event");
  await user.click(screen.getByRole("button", { name: /摸头/ }));
  expect(preview).toHaveAttribute("data-mode", "inspect");
  expect(preview).toHaveAttribute("data-event", "pet");
  await user.click(screen.getByRole("button", { name: /^待机/ }));
  expect(preview).toHaveAttribute("data-event", "idle");
  expect(state.save).not.toHaveBeenCalled();
});

test("motion capabilities are explicit for Live2D and layered habits and demos work by keyboard", async () => {
  const first = render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "习惯" }));
  expect(
    screen.getByRole("checkbox", { name: "边缘攀爬（Live2D 暂不支持）" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("checkbox", { name: "高处滑翔（Live2D 暂不支持）" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "试玩" }));
  expect(screen.getByRole("button", { name: "拎起" })).toBeDisabled();
  first.unmount();
  state.document = {
    ...state.document!,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      rigProfile: "human-chibi",
      character: { name: "牧濑红莉栖" },
      schemes: [
        { id: "kurisu-classic", brand: "牧濑红莉栖", label: "经典便服" },
      ],
    },
  };
  render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "习惯" }));
  for (const name of ["边缘攀爬", "高处滑翔"]) {
    const checkbox = screen.getByRole("checkbox", { name });
    expect(checkbox).toBeChecked();
    checkbox.focus();
    await userEvent.keyboard(" ");
    expect(checkbox).not.toBeChecked();
  }
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(state.save.mock.lastCall![1].habits).toMatchObject({
    edgeClimbing: false,
    highGliding: false,
  });
  await userEvent.click(screen.getByRole("button", { name: "试玩" }));
  for (const name of ["左侧攀爬", "右侧攀爬", "向左滑翔", "向右滑翔", "拎起"]) {
    const button = screen.getByRole("button", { name });
    button.focus();
    await userEvent.keyboard(" ");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(new RegExp(`姿态：${name}`))).toBeVisible();
  }
});

test("compact panel switches retain draft fields and the mounted stage", async () => {
  const user = userEvent.setup();
  const view = render(<EditorPage projectId="pet-1" onBack={() => {}} />);
  await screen.findByText("形象与皮肤");
  const panels = within(
    view.container.querySelector(".compact-panel-tabs") as HTMLElement,
  );
  await user.click(panels.getByText("属性"));
  await user.click(screen.getByRole("button", { name: "聊天" }));
  await user.type(screen.getByRole("textbox", { name: "性格" }), "保留草稿");
  const stage = screen.getByTestId("pet-preview");
  const key = stage.getAttribute("data-key");
  await user.click(panels.getByText("列表"));
  await user.click(panels.getByText("预览"));
  await user.click(panels.getByText("属性"));
  expect(screen.getByRole("textbox", { name: "性格" })).toHaveValue("保留草稿");
  expect(screen.getByTestId("pet-preview")).toBe(stage);
  expect(view.container.querySelector(".dp-editor")).toHaveAttribute(
    "data-panel",
    "properties",
  );
  expect(stage).toHaveAttribute("data-key", key);
  expect(state.save).not.toHaveBeenCalled();
});
