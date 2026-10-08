import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmadeusWindow } from "../src/features/amadeus/Window";
import type { Conversation } from "../src/features/amadeus/protocol";
import { groupConversations } from "../src/features/amadeus/conversationGroups";

const { removeConversation, renameConversation } = vi.hoisted(() => ({
  removeConversation: vi.fn(),
  renameConversation: vi.fn(),
}));

beforeEach(() => {
  removeConversation.mockReset().mockResolvedValue(undefined);
  renameConversation.mockReset().mockResolvedValue(undefined);
});

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
    const [deleteItem, setDeleteItem] = useState<Conversation | null>(null);
    const [renameItem, setRenameItem] = useState<Conversation | null>(null);
    const [renameTitle, setRenameTitle] = useState("");
    const [items, setItems] = useState([{ id: "one", title: "当前对话" }]);
    const [error, setError] = useState("");
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
      error,
      setError,
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
      renameItem,
      setRenameItem,
      renameTitle,
      setRenameTitle,
      deleteItem,
      setDeleteItem,
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
      rename: async (item: Conversation, title: string) => {
        await renameConversation(item, title);
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, title } : entry,
          ),
        );
        setRenameItem(null);
      },
      remove: async (item: Conversation) => {
        await removeConversation(item);
        setDeleteItem(null);
      },
      importAttachment: vi.fn(),
      showFiles: vi.fn(),
      previewFile: vi.fn(),
      downloadFile: vi.fn(),
      send: vi.fn(),
      scopedContexts: [],
      groups: [{ name: "今天", items }],
    };
  },
}));

describe("Amadeus conversation layout", () => {
  it("renames inside the selected history row with automatic focus and Enter to save", async () => {
    const user = userEvent.setup();
    render(<AmadeusWindow session={null as never} />);
    const title = screen.getByRole("button", { name: "当前对话" });
    const row = title.closest(".amadeus-history-row");
    await user.click(
      screen.getByRole("button", { name: "重命名对话「当前对话」" }),
    );
    const input = screen.getByRole("textbox", { name: "对话名称" });
    expect(row).toContainElement(input);
    expect(input).toHaveFocus();
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(4);
    expect(document.querySelector(".amadeus-history-dialog")).toBeNull();
    await user.clear(input);
    await user.type(input, "  新名称  ");
    await user.keyboard("{Enter}");
    expect(renameConversation).toHaveBeenCalledExactlyOnceWith(
      { id: "one", title: "当前对话" },
      "新名称",
    );
    expect(
      await screen.findByRole("button", { name: "新名称" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "对话名称" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "新名称" })).toHaveFocus(),
    );
  });

  it("cancels inline renaming without saving and ignores composing Enter or a blank title", async () => {
    const user = userEvent.setup();
    render(<AmadeusWindow session={null as never} />);
    await user.click(
      screen.getByRole("button", { name: "重命名对话「当前对话」" }),
    );
    const input = screen.getByRole("textbox", { name: "对话名称" });
    await user.clear(input);
    await user.type(input, "草稿标题");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(renameConversation).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: "保存对话名称" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(renameConversation).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "对话名称" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "当前对话" })).toHaveFocus(),
    );
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("keeps the inline draft on failure and blocks duplicate submissions while saving", async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    renameConversation.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(<AmadeusWindow session={null as never} />);
    await user.click(
      screen.getByRole("button", { name: "重命名对话「当前对话」" }),
    );
    const input = screen.getByRole("textbox", { name: "对话名称" });
    await user.clear(input);
    await user.type(input, "尚未保存的新名称");
    await user.click(screen.getByRole("button", { name: "保存对话名称" }));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存对话名称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消重命名" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(renameConversation).toHaveBeenCalledOnce();
    fail(new Error("名称保存失败"));
    const form = input.closest("form")!;
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "名称保存失败",
    );
    expect(input).toHaveValue("尚未保存的新名称");
    expect(input).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "取消重命名" }));
    expect(
      screen.getByRole("button", { name: "当前对话" }),
    ).toBeInTheDocument();
  });

  it("keeps an edited conversation visible when its refreshed title no longer matches the search", () => {
    const items = [
      {
        id: "one",
        title: "其他窗口的新标题",
        updated_at: new Date().toISOString(),
      },
    ] as Conversation[];
    expect(groupConversations(items, "当前")).toEqual([]);
    expect(
      groupConversations(items, "当前", "one").flatMap((group) => group.items),
    ).toEqual(items);
  });

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

  it("opens deletion outside the history rail and restores focus when cancelled", async () => {
    const user = userEvent.setup();
    render(<AmadeusWindow session={null as never} />);
    const trigger = screen.getByRole("button", {
      name: "删除对话「当前对话」",
    });
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog", {
      name: "删除「当前对话」？",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "这会同时删除本地消息与会话文件，删除后无法恢复。",
    );
    expect(
      screen.getByRole("complementary", { name: "对话侧栏" }),
    ).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(removeConversation).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    fireEvent.mouseDown(screen.getByRole("alertdialog").parentElement!);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(removeConversation).not.toHaveBeenCalled();
  });

  it("requires confirmation and prevents repeated deletion or dismissal while pending", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    removeConversation.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<AmadeusWindow session={null as never} />);
    await user.click(
      screen.getByRole("button", { name: "删除对话「当前对话」" }),
    );
    expect(removeConversation).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    expect(removeConversation).toHaveBeenCalledExactlyOnceWith({
      id: "one",
      title: "当前对话",
    });
    expect(
      within(dialog).getByRole("button", { name: "处理中…" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "处理中…" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog.parentElement!);
    expect(dialog).toBeVisible();
    expect(removeConversation).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps deletion failures visible inside the confirmation and allows cancellation", async () => {
    const user = userEvent.setup();
    removeConversation.mockRejectedValueOnce(new Error("删除失败，请稍后再试"));
    render(<AmadeusWindow session={null as never} />);
    await user.click(
      screen.getByRole("button", { name: "删除对话「当前对话」" }),
    );
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "删除失败，请稍后再试",
    );
    expect(within(dialog).getByRole("button", { name: "删除" })).toBeEnabled();
    expect(removeConversation).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
