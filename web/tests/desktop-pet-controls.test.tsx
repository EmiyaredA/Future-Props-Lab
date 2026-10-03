import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PetPicker } from "../src/features/desktop-pet/PetPicker";
import { SkinUpload } from "../src/features/desktop-pet/SkinUpload";

function Picker() {
  const [value, setValue] = useState("stand");
  return (
    <PetPicker
      label="动作"
      value={value}
      onChange={setValue}
      options={[
        { value: "stand", label: "站立" },
        { value: "unavailable", label: "不可用动作", disabled: true },
        { value: "jump", label: "跳跃" },
      ]}
    />
  );
}

test("picker exposes its checked value, skips disabled entries and restores trigger focus", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  const trigger = screen.getByRole("button", { name: "动作" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("menuitemradio", { name: "站立" })).toBeChecked();
  expect(
    screen.getByRole("menuitemradio", { name: "不可用动作" }),
  ).toHaveAttribute("data-disabled");
  await user.keyboard("{Home}{ArrowDown}");
  expect(screen.getByRole("menuitemradio", { name: "跳跃" })).toHaveFocus();
  expect(screen.getByRole("menuitemradio", { name: "站立" })).toBeChecked();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveTextContent("跳跃");
  await user.keyboard("{Enter}{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("skin upload supports keyboard activation and deliberate same-file retry", async () => {
  const upload = vi.fn();
  const view = render(
    <SkinUpload name="外套" disabled={false} onUpload={upload} />,
  );
  const button = screen.getByRole("button", { name: "为 外套 上传 PNG" });
  const input = screen.getByLabelText("选择 外套 的 PNG") as HTMLInputElement;
  const click = vi.spyOn(input, "click");
  button.focus();
  await userEvent.keyboard(" ");
  expect(click).toHaveBeenCalledOnce();
  const file = new File(["png"], "coat.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(input, { target: { files: [file] } });
  expect(upload).toHaveBeenCalledTimes(2);
  view.rerender(<SkinUpload name="外套" disabled onUpload={upload} />);
  expect(button).toBeDisabled();
  fireEvent.change(input, { target: { files: [file] } });
  expect(upload).toHaveBeenCalledTimes(2);
});
