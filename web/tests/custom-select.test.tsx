import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { CustomSelect } from "@shared/ui/CustomSelect";

const options = [
  { value: "zh-CN", label: "简体中文" },
  { value: "ja-JP", label: "日本語", disabled: true },
  { value: "en-US", label: "English" },
];

function Fixture() {
  const [value, setValue] = useState("zh-CN");
  return (
    <CustomSelect
      ariaLabel="目标语言"
      value={value}
      options={options}
      onChange={setValue}
    />
  );
}

describe("CustomSelect keyboard model", () => {
  test("opens with arrows, skips disabled options and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole("combobox", { name: "目标语言" });

    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "简体中文" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "English" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveTextContent("English");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("supports Home, End and Escape without changing the selection", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole("combobox", { name: "目标语言" });

    trigger.focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("option", { name: "English" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("option", { name: "简体中文" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(trigger).toHaveTextContent("简体中文");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
