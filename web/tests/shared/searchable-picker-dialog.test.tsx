import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  SearchablePickerDialog,
  type PickerItem,
} from "@shared/ui/SearchablePickerDialog";

const items: PickerItem[] = [
  { id: "blue", label: "蓝色场景" },
  { id: "red", label: "红色场景" },
];

function openPicker(
  onChoose: (item: PickerItem | null) => void | Promise<void>,
) {
  const closed = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>打开选择器</button>
        {open && (
          <SearchablePickerDialog
            title="选择场景"
            items={items}
            onChoose={onChoose}
            onClose={() => {
              closed();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  render(<Harness />);
  return closed;
}

test("opens, focuses search, filters choices and restores opener focus after selection", async () => {
  const user = userEvent.setup();
  const choose = vi.fn();
  openPicker(choose);
  const opener = screen.getByRole("button", { name: "打开选择器" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "选择场景" });
  expect(dialog).toHaveAttribute("open");
  const search = screen.getByRole("searchbox", { name: "搜索素材" });
  expect(search).toHaveFocus();
  await user.type(search, "蓝色");
  expect(
    screen.queryByRole("button", { name: "红色场景" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "蓝色场景" }));
  await user.click(screen.getByRole("button", { name: "确认选择" }));
  expect(choose).toHaveBeenCalledWith(items[0]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(dialog).not.toHaveAttribute("open");
  expect(opener).toHaveFocus();
});

test("blocks native cancellation while a selection is being submitted", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const closed = openPicker(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole("button", { name: "打开选择器" }));
  await user.click(screen.getByRole("button", { name: "蓝色场景" }));
  await user.click(screen.getByRole("button", { name: "确认选择" }));
  expect(screen.getByRole("button", { name: "关闭选择场景" })).toBeDisabled();
  // jsdom does not translate Escape to the native dialog cancel event.
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(closed).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
});
