import { fireEvent, render, screen } from "@testing-library/react";
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
  characters: [],
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

    await user.selectOptions(screen.getByLabelText("插入变量"), "player-name");
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
});
