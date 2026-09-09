import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteTags } from "@features/thought-workshop/NoteTags";

describe("笔记标签编辑", () => {
  it("commits trimmed unique tags on blur without stealing the next control's focus", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    function Harness() {
      const [tags, setTags] = useState(["灵感"]);
      return (
        <>
          <NoteTags
            tags={tags}
            onChange={(next) => {
              changed(next);
              setTags(next);
            }}
          />
          <button>正文之后</button>
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "编辑标签" }));
    const input = screen.getByRole("textbox", { name: "笔记标签" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, " 产品思考，灵感, 产品思考,  ");
    expect(changed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "正文之后" }));
    expect(changed).toHaveBeenCalledWith(["产品思考", "灵感"]);
    expect(screen.getByText("产品思考")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "正文之后" })).toHaveFocus(),
    );
  });

  it("cancels with Escape and submits with Enter, but does not submit composition keys", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<NoteTags tags={["原标签"]} onChange={changed} />);
    await user.click(screen.getByRole("button", { name: "编辑标签" }));
    await user.type(screen.getByRole("textbox"), "修改");
    await user.keyboard("{Escape}");
    expect(changed).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "编辑标签" })).toHaveFocus(),
    );
    await user.keyboard("{Enter}");
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "新标签{Enter}");
    expect(changed).toHaveBeenCalledWith(["新标签"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "编辑标签" })).toHaveFocus(),
    );
  });

  it("reflects adopted server tags and flushes the input before the save shortcut bubbles", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const props = { onChange: () => events.push("tags") };
    const view = render(<NoteTags tags={["本地"]} {...props} />);
    view.rerender(<NoteTags tags={["服务器"]} {...props} />);
    expect(screen.queryByText("本地")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑标签" }));
    expect(screen.getByRole("textbox")).toHaveValue("服务器");
    await user.type(screen.getByRole("textbox"), ", 新标签");
    const save = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "s") events.push("save");
    };
    window.addEventListener("keydown", save);
    try {
      await user.keyboard("{Control>}s{/Control}");
    } finally {
      window.removeEventListener("keydown", save);
    }
    expect(events).toEqual(["tags", "save"]);
  });
});
