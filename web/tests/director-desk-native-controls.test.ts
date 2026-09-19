import { describe, expect, it } from "vitest";
import { assertMediaResources } from "@features/director-desk/editor/media/model";
import { mountNativeControls } from "@features/director-desk/editor/ui/native-controls";

describe("director desk open", () => {
  it("treats a null media list as no embedded media", () => {
    expect(() => assertMediaResources(null)).not.toThrow();
    expect(() => assertMediaResources(undefined)).not.toThrow();
  });
});

describe("director desk native controls", () => {
  it("keeps select values and change events while hiding the native popup", async () => {
    document.body.innerHTML = `<div class="director-desk-root"><select id="aspect" aria-label="项目画幅"><option value="16:9">16:9</option><option value="9:16">9:16</option></select></div>`;
    const release = mountNativeControls();
    const select = document.querySelector<HTMLSelectElement>("#aspect")!;
    const trigger = document.querySelector<HTMLButtonElement>(".director-select-trigger")!;
    expect(select.classList.contains("director-native-control")).toBe(true);
    expect(trigger.textContent).toContain("16:9");
    let changed = 0;
    select.addEventListener("change", () => {
      changed += 1;
    });
    trigger.click();
    document.querySelectorAll<HTMLButtonElement>(".director-select-option")[1].click();
    expect(select.value).toBe("9:16");
    expect(changed).toBe(1);
    expect(trigger.textContent).toContain("9:16");
    select.innerHTML = `<option value="16:9" selected>16:9</option><option value="9:16">9:16</option>`;
    await Promise.resolve();
    expect(trigger.textContent).toContain("16:9");
    release();
  });

  it("writes color choices back through input and change", () => {
    document.body.innerHTML = `<div class="director-desk-root"><input id="zone-color" type="color" value="#ffffff" aria-label="标记颜色"></div>`;
    const release = mountNativeControls();
    const input = document.querySelector<HTMLInputElement>("#zone-color")!;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    document.querySelector<HTMLButtonElement>(".director-color-trigger")!.click();
    document.querySelector<HTMLButtonElement>('[data-swatch="#202020"]')!.click();
    expect(input.value).toBe("#202020");
    expect(events).toEqual(["input", "change"]);
    release();
  });

  it("keeps a multiple select as a checkbox list", () => {
    document.body.innerHTML = `<div class="director-desk-root"><select id="field-targets" multiple><option value="a">甲</option><option value="b" selected>乙</option></select></div>`;
    const release = mountNativeControls();
    const select = document.querySelector<HTMLSelectElement>("#field-targets")!;
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".director-multi-option input")];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
    boxes[0].click();
    expect([...select.selectedOptions].map((option) => option.value)).toEqual(["a", "b"]);
    release();
  });
});
