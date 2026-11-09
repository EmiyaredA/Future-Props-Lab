import { describe, expect, it, vi } from "vitest";
import { assistantElementSource } from "@platform/assistantElements";
import { createPageBridge } from "@features/amadeus/pageBridge";
import {
  elementReference,
  mergeReferences,
} from "@features/amadeus/elementReferences";

const scope = {
  resource: "presentation",
  application: "演示工坊",
  projectId: "deck",
  unsaved: true,
} as const;
const items = Array.from({ length: 22 }, (_, i) => ({
  id: `element-${i}`,
  parentId: "slide",
  kind: "slide_element" as const,
  name: `形状 ${i}`,
}));

describe("Amadeus element references", () => {
  it("captures native selection on request and bounds repeated picks", () => {
    const close = vi.fn();
    const bridge = createPageBridge("account", close);
    const onReference = vi.fn();
    bridge.onAmadeusReference(onReference);
    const source = assistantElementSource(
      scope,
      items,
      items.map((item) => item.id),
    );
    bridge.registerElementSource(() => source);
    expect(onReference).not.toHaveBeenCalled();

    const selected = bridge.selectedAmadeusElements();
    const added = mergeReferences([], selected);
    expect(added).toHaveLength(20);
    expect(added[0].target).toEqual({
      project_resource: "presentation",
      project_id: "deck",
      element_kind: "slide_element",
      element_id: "element-0",
      parent_id: "slide",
      unsaved: true,
    });
    const saved = elementReference(source, { ...items[0], unsaved: false });
    const refreshed = mergeReferences(added, [saved, selected[20]]);
    expect(refreshed).toHaveLength(20);
    expect(refreshed[0].target?.unsaved).toBe(false);
    expect(onReference).not.toHaveBeenCalled();
  });

  it("keeps scoped targets distinct and replaces cancelled sources", async () => {
    const bridge = createPageBridge("account", vi.fn());
    const finish = vi.fn();
    bridge.onAmadeusPickFinished(finish);
    const current = assistantElementSource(scope, items, [items[0].id]);
    const other = assistantElementSource(
      { ...scope, projectId: "other-deck" },
      items,
      [],
    );
    const dispose = bridge.registerElementSource(() => current);
    await bridge.setAmadeusPickMode(true, 1);
    const release = bridge.registerElementSource(() => other);
    dispose();
    expect(bridge.currentElementSource()).toBe(other);
    expect(bridge.selectedAmadeusElements()).toEqual([]);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(
      mergeReferences(
        [],
        [
          elementReference(current, items[0]),
          elementReference(other, items[0]),
          elementReference(current, { ...items[0], parentId: "another-slide" }),
        ],
      ),
    ).toHaveLength(3);
    await bridge.setAmadeusPickMode(true, 1);
    release();
    expect(finish).toHaveBeenCalledTimes(2);
  });
});
