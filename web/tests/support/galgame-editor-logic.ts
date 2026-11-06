import { within } from "@testing-library/react";
import { beforeAll, vi } from "vitest";

// These editor tests exercise authoring, navigation, and persistence. The
// browser suite covers the layout cascade, which is expensive to evaluate in jsdom.
vi.mock("@features/galgame-workshop/galgameStyles", () => ({}));

beforeAll(async () => {
  // Keep cold module transforms out of interaction waits. The editor still
  // renders the real lazy workspaces and the browser suite tests cold loading.
  await Promise.all([
    import("@features/galgame-workshop/editor/AssetCenter"),
    import("@features/galgame-workshop/editor/EditorInspectors"),
    import("@features/galgame-workshop/editor/StoryBlockEditor"),
    import("@features/galgame-workshop/editor/StoryTimelineEditor"),
  ]);
});

// Scope accessible-name queries to the active surface to avoid computing
// names and visibility for every control elsewhere in the editor.
export function withinEditorPanel(container: ParentNode, selector: string) {
  const panel = container.querySelector<HTMLElement>(selector);
  if (!panel) throw new Error(`Missing editor panel ${selector}`);
  return within(panel);
}
