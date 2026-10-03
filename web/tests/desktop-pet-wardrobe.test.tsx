import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PackageUpdate } from "../src/features/desktop-pet/PackageUpdate";
import { outfitAlpha } from "../src/features/desktop-pet/humanFigure";

test("resource picker supports keyboard and accepts the same file for a deliberate retry", async () => {
  const update = vi.fn();
  const view = render(<PackageUpdate disabled={false} onUpdate={update} />);
  const button = screen.getByRole("button", { name: "更新角色资源包" });
  button.focus();
  expect(button).toHaveFocus();
  const input = screen.getByLabelText("选择更新角色资源包") as HTMLInputElement;
  const click = vi.spyOn(input, "click");
  await userEvent.keyboard("{Enter}");
  expect(click).toHaveBeenCalledOnce();
  const file = new File(["zip"], "wardrobe.zip", { type: "application/zip" });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(input, { target: { files: [file] } });
  expect(update).toHaveBeenCalledTimes(2);
  expect(input.value).toBe("");
  view.rerender(
    <PackageUpdate disabled reason="请先保存当前修改" onUpdate={update} />,
  );
  expect(button).toBeDisabled();
  expect(screen.getByText("请先保存当前修改")).toBeVisible();
  fireEvent.change(input, { target: { files: [file] } });
  expect(update).toHaveBeenCalledTimes(2);
});

test("optional standing/seated garment fades preserve legacy behavior and clamp pose transitions", () => {
  const scheme = {
    id: "maid",
    outfit: { standingParts: ["coat"], seatedParts: ["outfit_sit"] },
  };
  expect(outfitAlpha(undefined, 1)).toEqual({
    leg_back: 0,
    leg_front: 0,
    sit_lower: 1,
  });
  expect(outfitAlpha(scheme, -1).coat).toBe(1);
  const middle = outfitAlpha(scheme, 0.5);
  expect(middle.coat).toBeCloseTo(0.5);
  expect(middle.outfit_sit).toBeCloseTo(0.5);
  expect(outfitAlpha(scheme, 2)).toMatchObject({ coat: 0, outfit_sit: 1 });
});
