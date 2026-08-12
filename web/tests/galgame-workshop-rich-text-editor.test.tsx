import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  GalgameStoryProject,
  GalgameStoryRichTextDocument,
} from "@features/galgame-workshop/api";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";

const document: GalgameStoryProject = {
  schemaVersion: "1.1",
  synopsis: "",
  characters: [
    {
      id: "hero",
      name: "真琴",
      description: "",
      expressions: [
        { id: "smile", label: "微笑", assetId: "portrait-smile" },
        { id: "calm", label: "平静", assetId: "portrait-calm" },
      ],
    },
  ],
  scenes: [],
  variables: [
    {
      id: "player-name",
      name: "玩家名",
      type: "string",
      defaultValue: "真由理",
      persistence: "session",
      description: "",
    },
  ],
  assets: [],
  chapters: [],
};

function Harness({
  onChange,
}: {
  onChange: (value: GalgameStoryRichTextDocument) => void;
}) {
  const [value, setValue] = useState<GalgameStoryRichTextDocument>({
    version: 1,
    nodes: [{ type: "text", text: "选择文字" }],
  });
  return (
    <RichTextEditor
      ariaLabel="剧情正文"
      placeholder="写下正文…"
      value={value}
      document={document}
      character={document.characters?.[0]}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("official rich text toolbar", () => {
  it("appears for a selection and writes structured marks", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    const input = screen.getByLabelText("剧情正文") as HTMLTextAreaElement;
    expect(input).toHaveAttribute("rows", "1");
    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.select(input);
    expect(screen.queryByLabelText("文字排版工具条")).not.toBeInTheDocument();
    input.setSelectionRange(0, 2);
    fireEvent.select(input);

    await user.click(screen.getByRole("button", { name: "粗体" }));

    expect(changed).toHaveBeenLastCalledWith({
      version: 1,
      nodes: [
        {
          type: "text",
          text: "选择",
          marks: { bold: true, italic: false, strike: false },
        },
        { type: "text", text: "文字" },
      ],
    });
  });

  it("inserts variable and player-wait nodes from the active selection", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    const input = screen.getByLabelText("剧情正文") as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(2, 3);
    fireEvent.select(input);

    await user.click(screen.getByRole("button", { name: "插入变量" }));
    await user.click(screen.getByRole("menuitem", { name: "玩家名" }));
    expect(changed.mock.calls.at(-1)?.[0].nodes).toContainEqual({
      type: "variable",
      variableId: "player-name",
    });

    await user.click(screen.getByRole("button", { name: "等待玩家继续" }));
    expect(changed.mock.calls.at(-1)?.[0].nodes).toContainEqual({
      type: "wait",
      mode: "player",
      durationMs: null,
    });
  });

  it("opens the character expression menu and inserts the selected expression", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    const input = screen.getByLabelText("剧情正文") as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(0, 2);
    fireEvent.select(input);

    await user.click(screen.getByRole("button", { name: "插入表情切换" }));
    const menu = screen.getByRole("menu", { name: "表情选项" });
    expect(within(menu).getByRole("menuitem", { name: "微笑" })).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "平静" }));

    expect(changed.mock.calls.at(-1)?.[0].nodes).toContainEqual({
      type: "expression",
      expressionId: "calm",
    });
  });

  it("keeps the selection active while a custom toolbar menu is open", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);
    const input = screen.getByLabelText("剧情正文") as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(0, 2);
    fireEvent.select(input);

    await user.click(screen.getByRole("button", { name: "字号" }));

    expect(screen.getByLabelText("文字排版工具条")).toBeVisible();
    expect(screen.getByRole("menu", { name: "字号选项" })).toBeVisible();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });
});
