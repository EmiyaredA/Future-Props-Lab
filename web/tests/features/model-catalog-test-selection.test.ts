import {
  availableCatalogModels,
  preferredChatModel,
  preferredModeModel,
} from "@features/models/conversation/catalogTestSelection";
import type { Catalog } from "@features/models/api";

const models: ReturnType<typeof availableCatalogModels> = [
  {
    value: "image-first",
    label: "Image A",
    description: "",
    capabilities: ["image_generation"],
    providerKind: "senseaudio_image" as const,
  },
  {
    value: "image-default",
    label: "Image B",
    description: "",
    capabilities: ["image_generation"],
    providerKind: "senseaudio_image" as const,
  },
  {
    value: "asr",
    label: "ASR",
    description: "",
    capabilities: ["speech_recognition"],
    providerKind: "senseaudio_asr" as const,
  },
];

test("new chat tests prefer an available workspace default and safely ignore stale defaults", () => {
  const catalog: Catalog = {
    revision: 0,
    suppliers: [],
    providers: [],
    default_model_ids: { chat: "chat-default" },
  };
  const candidates = [{ value: "chat-first" }, { value: "chat-default" }];
  expect(preferredChatModel(catalog, candidates)).toBe("chat-default");
  expect(preferredChatModel(catalog, candidates.slice(0, 1))).toBe(
    "chat-first",
  );
  expect(preferredChatModel(catalog, [])).toBeUndefined();
});

test("generation modes prefer the last manual selection, then a compatible default", () => {
  const defaults = {
    image_generation: "image-default",
    speech_recognition: "asr",
  };
  expect(preferredModeModel(models, "image", undefined, defaults)?.value).toBe(
    "image-default",
  );
  expect(
    preferredModeModel(models, "image", "image-first", defaults)?.value,
  ).toBe("image-first");
  expect(preferredModeModel(models, "image", "removed", defaults)?.value).toBe(
    "image-default",
  );
  expect(
    preferredModeModel(models, "image", undefined, { image_generation: "asr" })
      ?.value,
  ).toBe("image-first");
  expect(preferredModeModel(models, "speech", undefined, defaults)?.value).toBe(
    "asr",
  );
  expect(
    preferredModeModel(models, "video", undefined, defaults),
  ).toBeUndefined();
});
