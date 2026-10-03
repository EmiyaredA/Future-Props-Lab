import { expect, test } from "vitest";
import { bubblePreview } from "../src/features/desktop-pet/chatPresentation";
import { contactShadow } from "../src/features/desktop-pet/whale-vendor/shadow.js";

test("bubble keeps complete opening sentences, handles Unicode and never exceeds 120 characters", () => {
  expect(bubblePreview("简短回复。")).toEqual({
    text: "简短回复。",
    truncated: false,
  });
  const reply = "先说结论。" + "接着解释。".repeat(30);
  const preview = bubblePreview(reply);
  expect(preview.truncated).toBe(true);
  expect(reply.startsWith(preview.text)).toBe(true);
  expect(preview.text.endsWith("。")).toBe(true);
  expect(Array.from(preview.text).length).toBeLessThanOrEqual(120);
  const unicode = bubblePreview("🧪".repeat(121));
  expect(Array.from(unicode.text)).toHaveLength(120);
  expect(unicode.text).not.toContain("�");
});

test("shadow stays subtle at contact, disappears in the air and while dragged, and scales with the pet", () => {
  expect(contactShadow(1, 0, 0, false).opacity).toBe(0.12);
  expect(contactShadow(1, -5, 0, false).opacity).toBe(0.12);
  expect(contactShadow(1, 30, 0, false).opacity).toBeLessThan(0.12);
  expect(contactShadow(1, 60, 0, false).opacity).toBe(0);
  expect(contactShadow(1, 0, 0, true).opacity).toBe(0);
  expect(contactShadow(2, 0, 0, false).rx).toBe(
    2 * contactShadow(1, 0, 0, false).rx,
  );
});
