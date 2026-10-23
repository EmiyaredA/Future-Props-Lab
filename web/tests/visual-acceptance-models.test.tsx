import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { AcceptanceModelPicker } from "@features/visual-workshop/acceptance/AcceptanceModelPicker";

const models = [
  {
    id: "a",
    label: "视觉模型",
    slug: "vision-primary",
    provider_name: "主线路",
    provider_kind: "openai" as const,
  },
  {
    id: "b",
    label: "视觉模型",
    slug: "vision-backup",
    provider_name: "备用线路",
    provider_kind: "anthropic" as const,
  },
];

function Picker() {
  const [value, setValue] = useState("");
  return (
    <AcceptanceModelPicker models={models} value={value} onChange={setValue} />
  );
}

test("rich model options distinguish matching names and preserve selected details", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  const trigger = screen.getByRole("combobox", { name: "验收视觉模型" });
  await user.click(trigger);
  const option = screen.getByRole("option", {
    name: "视觉模型 · vision-backup · 备用线路",
  });
  expect(
    within(option).getByText("视觉模型", { selector: "strong" }),
  ).toBeVisible();
  expect(
    within(option).getByText("vision-backup", { selector: "code" }),
  ).toBeVisible();
  expect(option.querySelector(".provider-brand-icon")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await user.click(option);
  expect(trigger).toHaveTextContent("视觉模型vision-backup备用线路");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Home}{ArrowDown}{Enter}");
  expect(trigger).toHaveTextContent("vision-primary");
  expect(trigger).not.toHaveTextContent("vision-backup");
  await user.keyboard("{End}{Escape}");
  expect(trigger).toHaveTextContent("vision-primary");
  expect(trigger).toHaveFocus();
});

test("empty model list retains a clear unselected placeholder", async () => {
  const user = userEvent.setup();
  render(<AcceptanceModelPicker models={[]} value="" onChange={() => {}} />);
  const trigger = screen.getByRole("combobox", { name: "验收视觉模型" });
  expect(trigger).toHaveTextContent("请选择视觉模型");
  await user.click(trigger);
  expect(screen.getAllByRole("option")).toHaveLength(1);
});
