import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useUnsavedNavigation } from "@shared/ui/useUnsavedNavigation";
import { guardedNavigation } from "@app/entries/navigation";

function Draft({ title }: { title: string }) {
  const [text, setText] = useState("");
  const guard = useUnsavedNavigation({
    dirty: Boolean(text),
    busy: false,
    title,
    description: "未提交填写将被放弃。",
  });
  return (
    <>
      <input
        aria-label={title}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {guard.dialog}
    </>
  );
}

it("asks each dirty feature in sequence and resumes navigation only after both agree", () => {
  const navigate = vi.fn();
  render(
    <NavigationProtection>
      <Draft title="来源设置" />
      <Draft title="账号设置" />
      <button onClick={() => guardedNavigation(navigate)}>切换应用</button>
    </NavigationProtection>,
  );
  fireEvent.change(screen.getByLabelText("来源设置"), {
    target: { value: "native path" },
  });
  fireEvent.change(screen.getByLabelText("账号设置"), {
    target: { value: "display name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "切换应用" }));
  expect(
    screen.getByRole("alertdialog", { name: "来源设置" }),
  ).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(
    screen.getByRole("alertdialog", { name: "账号设置" }),
  ).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "留在此页" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("来源设置")).toHaveValue("native path");
  fireEvent.click(screen.getByRole("button", { name: "切换应用" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(navigate).toHaveBeenCalledOnce();
});

it("unmodified applications navigate immediately", () => {
  const navigate = vi.fn();
  render(
    <NavigationProtection>
      <Draft title="来源设置" />
      <button onClick={() => guardedNavigation(navigate)}>切换应用</button>
    </NavigationProtection>,
  );
  fireEvent.click(screen.getByRole("button", { name: "切换应用" }));
  expect(navigate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it("does not ask a second native prompt after all document navigation guards were accepted", async () => {
  let nativeBlocked: boolean | undefined;
  const proceed = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    nativeBlocked = event.defaultPrevented;
  };
  render(
    <NavigationProtection>
      <Draft title="来源设置" />
      <button onClick={() => guardedNavigation(proceed, true)}>离开网站</button>
    </NavigationProtection>,
  );
  fireEvent.change(screen.getByLabelText("来源设置"), {
    target: { value: "draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "离开网站" }));
  const blocked = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(nativeBlocked).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 1));
  const later = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(later);
  expect(later.defaultPrevented).toBe(true);
});
