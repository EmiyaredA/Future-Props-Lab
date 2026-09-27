import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AmadeusWindow } from "../src/features/amadeus/Window";

vi.mock("../src/features/amadeus/Avatar", () => ({
  AmadeusAvatar: () => <span data-testid="amadeus-avatar" />,
}));

vi.mock("../src/features/amadeus/useAppearance", () => ({
  useAppearance: () => ({ name: "红莉栖", url: "", notice: null }),
}));

vi.mock("../src/features/amadeus/useAmadeusController", () => ({
  useAmadeusController: () => {
    const [historyOpen, setHistoryOpen] = useState(true);
    const [mode, setMode] = useState<"agent" | "plan">("agent");
    return {
      bridge: {
        setAmadeusStageOpen: vi.fn().mockResolvedValue(true),
        setAmadeusAlwaysOnTop: vi.fn().mockResolvedValue(true),
      },
      detail: null,
      runs: [],
      mode,
      setMode,
      historyOpen,
      setHistoryOpen,
      search: "",
      setSearch: vi.fn(),
      references: [],
      setReferences: vi.fn(),
      draft: "",
      setDraft: vi.fn(),
      busy: false,
      saving: false,
      activeRun: null,
      error: "",
      setError: vi.fn(),
      models: [],
      modelId: "",
      setModelId: vi.fn(),
      toolSteps: [],
      scriptOutput: "",
      capabilitiesOpen: false,
      setCapabilitiesOpen: vi.fn(),
      toolApis: [],
      mcpServers: [],
      skills: [],
      loaded: [],
      setLoaded: vi.fn(),
      approval: null,
      renameItem: null,
      setRenameItem: vi.fn(),
      renameTitle: "",
      setRenameTitle: vi.fn(),
      deleteItem: null,
      setDeleteItem: vi.fn(),
      modelPickerOpen: false,
      setModelPickerOpen: vi.fn(),
      attachments: [],
      filesOpen: false,
      setFilesOpen: vi.fn(),
      workFiles: [],
      filePreview: null,
      setFilePreview: vi.fn(),
      scriptAvailable: false,
      registeredOperations: 0,
      previewReference: null,
      setPreviewReference: vi.fn(),
      avatarState: "idle",
      alwaysOnTop: true,
      setAlwaysOnTop: vi.fn(),
      fileInputRef: { current: null },
      showAvatarState: vi.fn(),
      open: vi.fn(),
      openCapabilities: vi.fn(),
      decideApproval: vi.fn(),
      answerQuestion: vi.fn(),
      continueRun: vi.fn(),
      stop: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      importAttachment: vi.fn(),
      showFiles: vi.fn(),
      previewFile: vi.fn(),
      downloadFile: vi.fn(),
      send: vi.fn(),
      scopedContexts: [],
      groups: [{ name: "今天", items: [{ id: "one", title: "当前对话" }] }],
    };
  },
}));

describe("Amadeus conversation layout", () => {
  it("defaults to Agent and allows switching to Plan", () => {
    render(<AmadeusWindow session={null as never} />);
    expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens both left cards and keeps the avatar stage closed by default", () => {
    render(<AmadeusWindow session={null as never} />);
    expect(
      screen.getByRole("button", { name: "收起当前上下文" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "收起对话历史" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("搜索本地对话")).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: "红莉栖数字人舞台" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "展开数字人" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("toggles the left cards independently and keeps history open when a conversation is selected", () => {
    render(<AmadeusWindow session={null as never} />);
    fireEvent.click(screen.getByRole("button", { name: "收起当前上下文" }));
    expect(
      screen.getByRole("button", { name: "展开当前上下文" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByPlaceholderText("搜索本地对话")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "当前对话" }));
    expect(
      screen.getByRole("button", { name: "收起对话历史" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "收起对话历史" }));
    expect(screen.getByPlaceholderText("搜索本地对话")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "展开当前上下文" }),
    ).toBeVisible();
  });

  it("opens the avatar stage on demand", () => {
    render(<AmadeusWindow session={null as never} />);
    fireEvent.click(screen.getByRole("button", { name: "展开数字人" }));
    expect(
      screen.getByRole("complementary", { name: "红莉栖数字人舞台" }),
    ).toBeVisible();
  });
});
