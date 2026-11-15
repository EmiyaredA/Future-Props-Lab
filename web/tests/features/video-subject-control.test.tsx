import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VideoSubjectControl } from "@features/models/generation/VideoSubjectControl";

function Editor({ initial = "", submit = vi.fn(), blur = vi.fn() }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(value);
      }}
    >
      <VideoSubjectControl value={value} onChange={setValue} onBlur={blur} />
      <button type="submit">生成</button>
      <output aria-label="保存值">{value}</output>
    </form>
  );
}
const input = () => screen.getByRole("textbox", { name: "追踪对象" });
const saved = () => screen.getByLabelText("保存值").textContent;

describe("tracking subject tags", () => {
  it("restores saved tags and follows external node changes", () => {
    const change = vi.fn();
    const { rerender } = render(
      <VideoSubjectControl value="person, hand" onChange={change} />,
    );
    expect(screen.getByRole("button", { name: "移除 person" })).toBeVisible();
    expect(screen.getByRole("button", { name: "移除 hand" })).toBeVisible();
    rerender(<VideoSubjectControl value="white dog" onChange={change} />);
    expect(
      screen.queryByRole("button", { name: "移除 hand" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 white dog" }),
    ).toBeVisible();
    expect(change).not.toHaveBeenCalled();
  });

  it("adds multiword tags with Enter, comma and the add button without submitting", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<Editor submit={submit} />);
    await user.type(input(), "white dog{Enter}hand,person");
    await user.click(screen.getByRole("button", { name: "添加追踪对象" }));
    expect(saved()).toBe("white dog, hand, person");
    expect(screen.getAllByRole("button", { name: /^移除/ })).toHaveLength(3);
    expect(input()).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps uncommitted text in the submitted value and commits on leaving the control", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const blur = vi.fn();
    render(<Editor submit={submit} blur={blur} />);
    await user.type(input(), "hand");
    expect(saved()).toBe("hand");
    fireEvent.submit(
      screen.getByRole("button", { name: "生成" }).closest("form")!,
    );
    expect(submit).toHaveBeenLastCalledWith("hand");
    await user.click(screen.getByRole("button", { name: "生成" }));
    expect(screen.getByRole("button", { name: "移除 hand" })).toBeVisible();
    expect(blur).toHaveBeenCalledOnce();
  });

  it("pastes and deduplicates a list, then removes tags by button and Backspace", async () => {
    const user = userEvent.setup();
    render(<Editor initial="person" />);
    await user.click(input());
    await user.paste("hand，white dog\nperson");
    expect(saved()).toBe("person, hand, white dog");
    await user.click(screen.getByRole("button", { name: "移除 hand" }));
    expect(saved()).toBe("person, white dog");
    await user.keyboard("{Backspace}");
    expect(saved()).toBe("person");
    expect(input()).toHaveFocus();
  });

  it("shows invalid input without discarding it and clears the error when corrected", async () => {
    const user = userEvent.setup();
    render(<Editor initial="person" />);
    await user.type(input(), "手{Enter}");
    expect(input()).toHaveValue("手");
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("请使用英文名称");
    await user.clear(input());
    await user.type(input(), "hand{Enter}");
    expect(saved()).toBe("person, hand");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not treat an IME confirmation as adding a tag", () => {
    render(<Editor />);
    fireEvent.change(input(), { target: { value: "hand" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(input()).toHaveValue("hand");
    expect(
      screen.queryByRole("button", { name: "移除 hand" }),
    ).not.toBeInTheDocument();
  });
});
