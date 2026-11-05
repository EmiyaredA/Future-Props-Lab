import { vi } from "vitest";

// These editor tests exercise authoring, navigation, and persistence. The
// browser suite covers the layout cascade, which is expensive to evaluate in jsdom.
vi.mock("@features/galgame-workshop/galgameStyles", () => ({}));
