import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { GenerationPromptField } from "@features/visual-workshop/generation/GenerationPromptField";
import type { PromptManagedFile } from "@features/visual-workshop/generation/generationPromptModel";
import { resolvePromptRendering } from "@features/visual-workshop/generation/promptRendering";
import { promptReferenceSlotsForInputs } from "@features/visual-workshop/generation/promptReferenceSlots";
import { h3PromptMentions } from "@features/visual-workshop/generation/h3PromptMentions";
import {
  editH3Source,
  h3ProtectedSource,
} from "@features/visual-workshop/generation/h3SourceEdits";
import {
  promptPartsFromValue,
  promptProjection,
} from "@features/visual-workshop/generation/generationPromptModel";

vi.mock("@features/visual-workshop/generation/GenerationMediaPreview", () => ({
  GenerationMediaPreview: ({ file }: { file: { id: string } }) => (
    <span data-media-id={file.id} />
  ),
}));
vi.mock("@shared/ui/ReadOnlyMedia", () => ({
  ReadOnlyMedia: ({
    path,
    kind,
    name,
  }: {
    path: string;
    kind: string;
    name: string;
  }) =>
    kind === "audio" ? (
      <audio src={path} aria-label={name} />
    ) : kind === "video" ? (
      <video src={path} aria-label={name} />
    ) : (
      <img src={path} alt={name} />
    ),
}));

const referencePrompt = `subject_definitions:
<Subject 1>: The woman in <Picture 1>.
<Video 1>: Source motion. <Audio 1>: Voice reference.
summary: [video editing + reference generation] Preserve the street.
retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): attribute_transfer.
detailed_description:
Hand-drawn 2D animation.
[Shot 1] <Subject 1> walks, following <Video 1>.
[Shot 2] At 00:03.000, she says <d>[Chinese] 你好！</d>
overall_soundscape: Footsteps and traffic.
non_diegetic_music: N/A`;

const basePrompt = `For the target video, at 0.00 seconds, <Picture 1> is fully referenced.

integrated_multimodal_description: [Shot 1] A woman walks. [Shot 2] At 00:03.000, she turns.
overall_soundscape: Wind.
non_diegetic_music: Soft piano.`;

const standaloneH3 = `subject_definitions
<Video 1> controls the exact timing, blocking, crop, real set and lights.
<Subject 1> follows the original black-suit male singer, replaced with swept spiky black hair, angular face, long white lab coat, plain crew neck and tan trousers in <Picture 1>.
<Subject 2> follows the original long-dark-haired white-dress woman, replaced with loose straight chestnut hair, violet eyes, tan cardigan, white shirt and red tie in <Picture 2>.
summary
An in-place stage edit. Draw only the original lead tracks.
retention_analysis
Keep only the listed lead tracks, exactly when visible.
detailed_description
[Shot 1, first 4.600s] Follow the original foreground Okabe and Kurisu as the camera pulls back, keeping their depth, gaze and separate reflections.
overall_soundscape
Original stage ambience.
non_diegetic_music
N/A`;

function reassemble(value: string) {
  return resolvePromptRendering(value)!
    .document.sections.map(
      (section) =>
        section.heading +
        section.blocks
          .map((block) => block.tokens.map((token) => token.text).join(""))
          .join(""),
    )
    .join("");
}

describe("MiniMax H3 adapter", () => {
  test.each([
    referencePrompt,
    basePrompt,
    "  subject_definitions:\r\n<Subject 1>: A person.\r\nsummary:\r\n\r\n",
    "detailed_description: An unfinished prompt\ncustom_field: Keep me.\n",
    "summary: Same-line content\ndetailed_description:\n\nnon_diegetic_music:",
    standaloneH3,
    standaloneH3.replace("subject_definitions", "subject_definition"),
    standaloneH3.replaceAll("\n", "\r\n"),
    "integrated_multimodal_description\n[Shot 1] Walk.\noverall_soundscape： Wind.\nnon_diegetic_music\nN/A",
  ])("preserves every source character: %s", (value) => {
    expect(reassemble(value)).toBe(value);
  });

  test.each([
    "",
    "普通视频提示词",
    "summary: A summary",
    "overall_soundscape: Rain.",
    'A JSON wrapper: {"detailed_description":"Walk"}',
    "<d>\nsubject_definitions: This is spoken dialogue.\n</d>",
    "subject_definitions describes the fields, rather than starting a section.",
    "<d>\nsubject_definitions\n[Shot 1, first 4.600s] Spoken literally.</d>",
  ])("does not falsely detect H3: %s", (value) => {
    expect(resolvePromptRendering(value)).toBeNull();
  });

  test("groups actual shots only in description sections and keeps dialogue atomic", () => {
    const document = resolvePromptRendering(referencePrompt)!.document;
    expect(document.sections.map((section) => section.field)).toEqual([
      "subject_definitions",
      "summary",
      "retention_analysis",
      "detailed_description",
      "overall_soundscape",
      "non_diegetic_music",
    ]);
    expect(document.sections[2].blocks).toHaveLength(1);
    expect(document.sections[2].blocks[0].kind).toBe("paragraph");
    expect(document.sections[3].blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "shot",
      "shot",
    ]);
    const kinds = document.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.tokens.map((token) => token.kind),
      ),
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        "subject",
        "picture",
        "video",
        "audio",
        "shot",
        "time",
        "dialogue",
      ]),
    );
    expect(
      resolvePromptRendering(basePrompt)!.document.sections[1].blocks.filter(
        (block) => block.kind === "shot",
      ),
    ).toHaveLength(2);
  });

  test("does not split headings or shot labels inside spoken dialogue", () => {
    const value =
      "detailed_description:\n[Shot 1] She says <d>[English] Heading:\nsummary: Test.\n[Shot 2] Not a cut.</d>\noverall_soundscape: Rain.";
    const document = resolvePromptRendering(value)!.document;
    expect(document.sections.map((section) => section.field)).toEqual([
      "detailed_description",
      "overall_soundscape",
    ]);
    expect(
      document.sections[0].blocks.filter((block) => block.kind === "shot"),
    ).toHaveLength(1);
    expect(reassemble(value)).toBe(value);
  });

  test("plain and unknown adapters fall back without rewriting", () => {
    expect(resolvePromptRendering(referencePrompt, "plain")).toBeNull();
    expect(
      resolvePromptRendering(referencePrompt, "future-template"),
    ).toBeNull();
    expect(
      resolvePromptRendering(referencePrompt, "minimax-h3")?.adapter.id,
    ).toBe("minimax-h3");
  });

  test("recognizes the screenshot's standalone six fields and preserves shot duration annotations", () => {
    const parsed = resolvePromptRendering(standaloneH3)!.document;
    expect(parsed.sections.map((section) => section.field)).toEqual([
      "subject_definitions",
      "summary",
      "retention_analysis",
      "detailed_description",
      "overall_soundscape",
      "non_diegetic_music",
    ]);
    expect(
      parsed.sections[3].blocks.find((block) => block.kind === "shot")
        ?.tokens[0],
    ).toMatchObject({ kind: "shot", text: "[Shot 1, first 4.600s]" });
    expect(reassemble(standaloneH3)).toBe(standaloneH3);
  });
});

const props = {
  assets: [],
  label: "视频提示词",
  placeholder: "描述镜头",
  canvasHistoryShortcuts: true,
};

async function selectTemplate(name: string) {
  await userEvent.click(
    screen.getByRole("combobox", { name: "提示词渲染模板" }),
  );
  await userEvent.click(screen.getByRole("option", { name }));
}

function copiedEditorSource(editor: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.keyDown(editor, { key: "a", ctrlKey: true });
  const setData = vi.fn();
  fireEvent.copy(editor, { clipboardData: { setData } });
  return setData.mock.calls[0]?.[1];
}

test("previews safely and switches templates without writing or saving the source", async () => {
  const onChange = vi.fn();
  const onBlur = vi.fn();
  const value =
    referencePrompt +
    '\n<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const { container } = render(
    <GenerationPromptField
      {...props}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
    />,
  );
  const preview = screen.getByRole("region", { name: "视频提示词渲染预览" });
  expect(
    within(preview).getByRole("heading", { name: /主体定义/ }),
  ).toBeInTheDocument();
  expect(
    within(preview).getAllByRole("button", { name: "查看主体1" }),
  ).toHaveLength(3);
  expect(preview.textContent).toContain('<img src=x onerror="alert(1)">');
  expect(container.querySelector("img, script")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(onBlur).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(screen.getByRole("textbox", { name: "视频提示词" }).textContent).toBe(
    value,
  );
  const toggle = screen.getByRole("switch", { name: "渲染提示词" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await selectTemplate("MiniMax H3");
  expect(screen.queryByRole("region")).toBeNull();
  toggle.focus();
  await userEvent.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(toggle).toHaveFocus();
  expect(
    screen.getByRole("combobox", { name: "提示词渲染模板" }),
  ).toHaveTextContent("MiniMax H3");
  expect(
    screen.getByRole("region", { name: "视频提示词渲染预览" }),
  ).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(onBlur).not.toHaveBeenCalled();
});

test("shows an explanation for forced H3 on plain text", async () => {
  const onChange = vi.fn();
  render(
    <GenerationPromptField {...props} value="普通文本" onChange={onChange} />,
  );
  expect(screen.getByRole("textbox")).toHaveTextContent("普通文本");
  await selectTemplate("MiniMax H3");
  expect(screen.getByRole("status")).toHaveTextContent(
    "未识别到 MiniMax H3 段落",
  );
  expect(screen.queryByRole("button", { name: /编辑原文|预览/ })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

test("opening source with renamed asset references does not rewrite a saved prompt", async () => {
  const file: PromptManagedFile = {
    id: "video",
    project_id: "project",
    folder_id: null,
    reference_id: null,
    original_filename: "reference.mp4",
    display_name: "新名称.mp4",
    prompt_reference_name: "新名称.mp4",
    prompt_legacy_names: ["reference.mp4"],
    media_kind: "video",
    mime_type: "video/mp4",
    byte_size: 100,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-11-21T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
  };
  const onChange = vi.fn();
  const value = referencePrompt + "\n[reference.mp4]";
  render(
    <GenerationPromptField
      {...props}
      assets={[file]}
      value={value}
      onChange={onChange}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(
    screen.getByRole("textbox").querySelector("[data-asset-id]"),
  ).toHaveTextContent("新名称.mp4");
  await selectTemplate("自动 · H3");
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(screen.getByRole("region").textContent).toContain("[reference.mp4]");
  expect(onChange).not.toHaveBeenCalled();
});

test("pasting H3 into a plain editor immediately renders the active template and keeps focus", async () => {
  const onBlur = vi.fn();
  function Harness() {
    const [value, setValue] = useState("普通文本");
    return (
      <GenerationPromptField
        {...props}
        value={value}
        onChange={setValue}
        onBlur={onBlur}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  act(() => editor.focus());
  editor.textContent = referencePrompt;
  fireEvent.input(editor);
  expect(screen.getByRole("textbox")).not.toBe(editor);
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(onBlur).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region").textContent).toContain("你好！");
  expect(copiedEditorSource(screen.getByRole("textbox"))).toBe(referencePrompt);
});

test("updates to a new version in preview and preserves an explicit source choice", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <GenerationPromptField
      {...props}
      value={referencePrompt}
      onChange={onChange}
    />,
  );
  rerender(
    <GenerationPromptField {...props} value={basePrompt} onChange={onChange} />,
  );
  expect(screen.getByRole("region").textContent).toContain("Soft piano.");
  expect(screen.queryByText("主体定义")).toBeNull();
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  rerender(
    <GenerationPromptField
      {...props}
      value={referencePrompt}
      onChange={onChange}
    />,
  );
  expect(copiedEditorSource(screen.getByRole("textbox"))).toBe(referencePrompt);
  expect(screen.queryByRole("region")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

test("copies the exact current version and reports clipboard failure", async () => {
  const user = userEvent.setup();
  const copy = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  const { rerender } = render(
    <GenerationPromptField
      {...props}
      value={referencePrompt}
      onChange={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "复制原文" }));
  expect(copy).toHaveBeenLastCalledWith(referencePrompt);
  expect(screen.getByRole("status")).toHaveTextContent("已复制原文");
  rerender(
    <GenerationPromptField {...props} value={basePrompt} onChange={vi.fn()} />,
  );
  await user.click(screen.getByRole("button", { name: "复制原文" }));
  expect(copy).toHaveBeenLastCalledWith(basePrompt);
  copy.mockRejectedValueOnce(new Error("Permission denied"));
  await user.click(screen.getByRole("button", { name: "复制原文" }));
  expect(screen.getByRole("status")).toHaveTextContent("复制失败");
  copy.mockRestore();
});

function media(
  id: string,
  kind: "image" | "video" | "audio",
): PromptManagedFile {
  return {
    id,
    project_id: "project",
    folder_id: null,
    reference_id: null,
    display_name: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
    original_filename: `${id}.source`,
    media_kind: kind,
    mime_type: `${kind}/test`,
    byte_size: 20,
    source: "project",
    is_reference: false,
    revision: 1,
    created_at: "2026-11-21T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
  };
}

test("omits only the known alignment instruction and main heading, preserving source for copy and editing", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const value =
    "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video.\n\nKeep this custom note.\n\n" +
    basePrompt.slice(basePrompt.indexOf("integrated_multimodal_description"));
  const onChange = vi.fn();
  render(
    <GenerationPromptField {...props} value={value} onChange={onChange} />,
  );
  const preview = screen.getByRole("region");
  expect(preview).not.toHaveTextContent("How the reference pictures align");
  expect(preview).not.toHaveTextContent("integrated_multimodal_description");
  expect(preview).not.toHaveTextContent("音画描述");
  expect(preview).toHaveTextContent("Keep this custom note.");
  expect(reassemble(value)).toBe(value);
  await user.click(screen.getByRole("button", { name: "复制原文" }));
  expect(copy).toHaveBeenCalledWith(value);
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(screen.getByRole("textbox").textContent).toBe(value);
  expect(onChange).not.toHaveBeenCalled();
  copy.mockRestore();
});

test("renders explicit protocol labels verbatim and leaves ordinary descriptions as text", () => {
  const value = `subject_definitions:\n<Subject 1> is the person in <Picture 1> and <Video 1>.\nsummary: [video continuation + audio reference] Continue the scene.\nretention_analysis:\n<Subject 1>: fully_preserved\n<Audio 1>: partially_copy\ndetailed_description:\n[Shot 1] The camera pushes in. <Subject 1> (S1,S2) says <d>[Chinese] 保留原话，<scenetrans>然后<cutoff></d> near a sign reading "营业中".\n[Shot 2] At 00:03.500, Static Shot.\noverall_soundscape: <Audio 1>\nnon_diegetic_music: N/A`;
  const document = resolvePromptRendering(value)!.document;
  const tokens = document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.tokens),
  );
  expect(tokens.map((token) => token.kind)).toEqual(
    expect.arrayContaining([
      "subject",
      "picture",
      "video",
      "audio",
      "task",
      "relationship",
      "speaker",
      "dialogue",
      "time",
    ]),
  );
  expect(reassemble(value)).toBe(value);
  render(<GenerationPromptField {...props} value={value} onChange={vi.fn()} />);
  expect(screen.getByText("fully_preserved")).toHaveAttribute(
    "title",
    "fully_preserved",
  );
  expect(screen.getByText("partially_copy")).toBeVisible();
  expect(screen.getByText("video continuation")).toBeVisible();
  expect(screen.getByText("audio reference")).toBeVisible();
  expect(screen.getByText("(S1,S2)")).toHaveAttribute("title", "说话人 S1,S2");
  expect(screen.getByText("[Chinese]")).toHaveClass("is-language");
  expect(screen.getByText("<scenetrans>")).toBeVisible();
  expect(screen.getByText("<cutoff>")).toBeVisible();
  expect(screen.getByLabelText("对白或歌词")).toHaveTextContent("保留原话，");
  expect(screen.getByRole("textbox")).toHaveTextContent('"营业中"');
  expect(
    screen.getByRole("textbox").querySelector(".is-camera, .is-screen-text"),
  ).toBeNull();
});

test("resolves references using input slots, never shifting unloaded inputs or treating Subject as a file index", async () => {
  const onChange = vi.fn();
  const value =
    "subject_definitions:\n<Subject 1> is a person in <Picture 2> and <Video 1>.\ndetailed_description: [Shot 1] <Picture 1> Picture 2 <Video 1> <Audio 1> <Subject 1>";
  const assets = [
    media("motion", "video"),
    media("last", "image"),
    media("voice", "audio"),
  ];
  const { rerender } = render(
    <GenerationPromptField
      {...props}
      value={value}
      onChange={onChange}
      assets={assets}
      referenceSlots={{
        picture: ["unloaded", "last"],
        video: ["motion"],
        audio: ["voice"],
      }}
    />,
  );
  expect(screen.getByText("图片1")).toHaveClass("is-unresolved");
  const picture = screen.getAllByRole("button", { name: "查看图片2" });
  expect(picture[0].querySelector("[data-media-id]")).toHaveAttribute(
    "data-media-id",
    "last",
  );
  expect(screen.queryByRole("button", { name: "查看图片1" })).toBeNull();
  expect(
    screen
      .getAllByRole("button", { name: "查看视频1" })[0]
      .querySelector("[data-media-id]"),
  ).toHaveAttribute("data-media-id", "motion");
  expect(
    screen
      .getByRole("button", { name: "查看音频1" })
      .querySelector("[data-media-id]"),
  ).toHaveAttribute("data-media-id", "voice");
  await userEvent.click(
    screen.getAllByRole("button", { name: "查看主体1" })[1],
  );
  expect(screen.getByRole("dialog", { name: "主体1预览" })).toHaveTextContent(
    "<Picture 2> and <Video 1>",
  );
  expect(
    screen
      .getByRole("dialog", { name: "主体1预览" })
      .querySelector("[data-media-id], img, video"),
  ).toBeNull();
  await userEvent.keyboard("{Escape}");
  rerender(
    <GenerationPromptField
      {...props}
      value={value}
      onChange={onChange}
      assets={assets}
      referenceSlots={{
        picture: ["last", "unloaded"],
        video: ["motion"],
        audio: ["voice"],
      }}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "查看图片1" })
      .querySelector("[data-media-id]"),
  ).toHaveAttribute("data-media-id", "last");
  expect(screen.queryByRole("button", { name: "查看图片2" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

test.each(["video", "audio"] as const)(
  "%s content is opened on demand, closes with Escape, restores focus and preserves the draft",
  async (kind) => {
    const file = media("reference", kind);
    const label = kind === "video" ? "Video" : "Audio";
    const name = kind === "video" ? "视频1" : "音频1";
    const onChange = vi.fn();
    const { container } = render(
      <GenerationPromptField
        {...props}
        value={`detailed_description: [Shot 1] Use <${label} 1>.`}
        assets={[file]}
        referenceSlots={{ [kind]: [file.id] }}
        onChange={onChange}
      />,
    );
    expect(container.querySelector("audio, video")).toBeNull();
    const trigger = screen.getByRole("button", { name: `查看${name}` });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: `${name}预览` });
    expect(dialog.querySelector(kind)).toHaveAttribute(
      "src",
      "/v1/files/reference/content",
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  },
);

test("input-mode label slots match first/last frames and explicit full references", () => {
  const inputs = {
    videoMode: "frames",
    framesOnly: true,
    firstFrame: [] as string[],
    lastFrame: ["last"],
    imageReferences: ["other"],
    videoReferences: ["motion"],
    audioReferences: ["voice"],
    linkedAssetIds: {
      image: ["first", "last"],
      video: ["motion", "linked"],
      audio: [],
    },
  };
  expect(promptReferenceSlotsForInputs(inputs)).toEqual({
    picture: ["first", "last"],
  });
  expect(
    promptReferenceSlotsForInputs({ ...inputs, framesOnly: false }),
  ).toEqual({ picture: [undefined, "last"] });
  expect(
    promptReferenceSlotsForInputs({
      ...inputs,
      firstFrame: ["same"],
      lastFrame: ["same"],
    }),
  ).toEqual({ picture: ["same", "same"] });
  expect(
    promptReferenceSlotsForInputs({ ...inputs, videoMode: "reference" }),
  ).toEqual({
    picture: ["other"],
    video: ["motion", "linked"],
    audio: ["voice"],
  });
  expect(
    promptReferenceSlotsForInputs({ ...inputs, videoMode: "text" }),
  ).toEqual({});
});

test("H3 subjects use only their numbers and never borrow a source image", async () => {
  const image = media("portrait", "image");
  const value =
    "subject_definitions:\n<Subject 1> 是蓝衣女孩，来自 <Picture 1>。\ndetailed_description:\n[Shot 1] <Subject 1> (S1) turns.\noverall_soundscape: Wind.\nnon_diegetic_music: N/A";
  const document = resolvePromptRendering(value)!.document;
  const options = h3PromptMentions(document, [image], { picture: [image.id] });
  expect(options.find((item) => item.kind === "subject")).toMatchObject({
    label: "主体1",
    source: "<Subject 1>",
  });
  expect(options.find((item) => item.kind === "subject")?.file).toBeUndefined();
  expect(promptProjection(promptPartsFromValue(value, [image], options))).toBe(
    value,
  );
  const changes = vi.fn();
  function Harness() {
    const [text, setText] = useState(value);
    return (
      <GenerationPromptField
        {...props}
        value={text}
        assets={[image]}
        referenceSlots={{ picture: [image.id] }}
        onChange={(next) => {
          changes(next);
          setText(next);
        }}
      />
    );
  }
  render(<Harness />);
  expect(
    screen.getAllByRole("button", { name: "查看主体1" })[0],
  ).toHaveTextContent("主体1");
  expect(
    screen
      .getAllByRole("button", { name: "查看主体1" })[0]
      .querySelector("[data-media-id], img"),
  ).toBeNull();
  const editor = screen.getByRole("textbox");
  act(() => editor.focus());
  expect(copiedEditorSource(editor)).toBe(value);
  const last = [...editor.querySelectorAll("[data-prompt-source-start]")].at(
    -1,
  )!;
  const range = window.document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(editor);
  await userEvent.keyboard("@");
  const list = screen.getByRole("listbox", { name: "引用已选素材" });
  expect(within(list).getByRole("option", { name: "图1" })).toBeVisible();
  expect(within(list).getByRole("option", { name: "主体1" })).toBeVisible();
  expect(within(list).getByRole("option", { name: "说话人 S1" })).toBeVisible();
  expect(within(list).getByRole("option", { name: "插入对白" })).toBeVisible();
  await userEvent.click(within(list).getByRole("option", { name: "图1" }));
  expect(changes).toHaveBeenLastCalledWith(value + "<Picture 1>");
  expect(copiedEditorSource(editor)).toBe(value + "<Picture 1>");
});

test("@ in rendered text inserts at the selected source position and saves the latest source once", async () => {
  const file = media("frame", "image");
  const initial =
    "How the reference pictures align with the target video — Picture 1 aligns with the 0.00-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] Opening.\r\n\r\n\r\nShe walks slowly.\noverall_soundscape: Wind.\nnon_diegetic_music: N/A";
  const save = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <GenerationPromptField
        {...props}
        value={value}
        assets={[file]}
        referenceSlots={{ picture: [file.id] }}
        onChange={setValue}
        onBlur={() => save(value)}
      />
    );
  }
  render(<Harness />);
  const preview = screen.getByRole("region");
  expect(
    preview.querySelectorAll(".is-description .prompt-render-block"),
  ).toHaveLength(2);
  const text = [
    ...preview.querySelectorAll<HTMLElement>("[data-prompt-source-start]"),
  ].find((element) => element.textContent?.includes("She walks slowly."))!;
  act(() => screen.getByRole("textbox").focus());
  const range = window.document.createRange();
  range.setStart(text.firstChild!, text.textContent!.indexOf(" slowly."));
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(text);
  await userEvent.keyboard("@");
  await userEvent.click(screen.getByRole("option", { name: "图1" }));
  const expected = initial.replace(
    "She walks slowly.",
    "She walks<Picture 1> slowly.",
  );
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(expected));
  expect(screen.getByRole("button", { name: "查看图片1" })).toBeVisible();
  expect(screen.getByRole("region")).not.toHaveTextContent(
    "How the reference pictures align",
  );
});

function selectRenderedText(editor: HTMLElement, text: string) {
  act(() => editor.focus());
  const token = [
    ...editor.querySelectorAll<HTMLElement>("[data-prompt-source-start]"),
  ].find(
    (element) =>
      element.firstChild?.nodeType === Node.TEXT_NODE &&
      element.textContent?.includes(text),
  )!;
  const start = token.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(token.firstChild!, start);
  range.setEnd(token.firstChild!, start + text.length);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(editor);
  return token;
}

function typeRenderedText(editor: HTMLElement, data: string) {
  fireEvent(
    editor,
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data,
      bubbles: true,
      cancelable: true,
    }),
  );
}

test("H3's registered frontend editor edits the rendered body, supports undo and preserves hidden source", async () => {
  const changes = vi.fn();
  function Harness() {
    const [value, setValue] = useState(basePrompt);
    return (
      <GenerationPromptField
        {...props}
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  expect(editor).toHaveAttribute("contenteditable", "true");
  expect(screen.queryByRole("button", { name: /编辑原文|预览/ })).toBeNull();
  selectRenderedText(editor, "walks");
  typeRenderedText(editor, "turns");
  const expected = basePrompt.replace("walks", "turns");
  expect(changes).toHaveBeenLastCalledWith(expected);
  expect(copiedEditorSource(editor)).toBe(expected);
  expect(editor).not.toHaveTextContent("fully referenced");
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  expect(changes).toHaveBeenLastCalledWith(basePrompt);
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true, shiftKey: true });
  expect(changes).toHaveBeenLastCalledWith(expected);
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(screen.queryByRole("region")).toBeNull();
  expect(copiedEditorSource(screen.getByRole("textbox"))).toBe(expected);
});

test("pasting into H3 renders standalone fields immediately and plain mode keeps its selected template", async () => {
  const changes = vi.fn();
  function Harness() {
    const [value, setValue] = useState(basePrompt);
    return (
      <GenerationPromptField
        {...props}
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  act(() => editor.focus());
  fireEvent.keyDown(editor, { key: "a", ctrlKey: true });
  fireEvent.paste(editor, { clipboardData: { getData: () => standaloneH3 } });
  expect(changes).toHaveBeenLastCalledWith(standaloneH3);
  expect(editor).toHaveTextContent("镜头1 · first 4.600s");
  expect(screen.getByRole("heading", { name: "主体定义" })).toBeVisible();
  expect(editor).not.toHaveTextContent("subject_definitions");
  expect(copiedEditorSource(editor)).toBe(standaloneH3);
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  const plain = screen.getByRole("textbox");
  act(() => plain.focus());
  plain.textContent = basePrompt;
  fireEvent.input(plain);
  expect(screen.queryByRole("region")).toBeNull();
  await selectTemplate("MiniMax H3");
  expect(screen.queryByRole("region")).toBeNull();
  await userEvent.click(screen.getByRole("switch", { name: "渲染提示词" }));
  expect(screen.getByRole("region")).toHaveTextContent("Soft piano.");
});

test("IME composition edits dialogue in place, commits once, and cancellation preserves the source", () => {
  const changes = vi.fn();
  function Harness() {
    const [value, setValue] = useState(referencePrompt);
    return (
      <GenerationPromptField
        {...props}
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  selectRenderedText(editor, "你好！");
  const copied = vi.fn();
  fireEvent.copy(editor, { clipboardData: { setData: copied } });
  expect(copied).toHaveBeenCalledWith("text/plain", "你好！");
  const token = selectRenderedText(editor, "你好");
  fireEvent.compositionStart(editor);
  token.textContent = "中间输入状态";
  fireEvent.compositionEnd(editor, { data: "早上好" });
  const expected = referencePrompt.replace("你好", "早上好");
  expect(changes).toHaveBeenCalledExactlyOnceWith(expected);
  expect(copiedEditorSource(editor)).toBe(expected);
  selectRenderedText(editor, "早上好");
  fireEvent.compositionStart(editor);
  fireEvent.compositionEnd(editor, { data: "" });
  expect(changes).toHaveBeenCalledTimes(1);
  expect(copiedEditorSource(editor)).toBe(expected);
});

test("clearing the H3 editor retains adapter undo history and source limits reject oversized insertion", () => {
  const changes = vi.fn();
  function Harness() {
    const [value, setValue] = useState(basePrompt);
    return (
      <GenerationPromptField
        {...props}
        maxLength={basePrompt.length + 10}
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  act(() => editor.focus());
  fireEvent.keyDown(editor, { key: "a", ctrlKey: true });
  fireEvent.keyDown(editor, { key: "Backspace" });
  expect(changes).toHaveBeenLastCalledWith("");
  expect(screen.getByRole("textbox")).toBe(editor);
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  expect(changes).toHaveBeenLastCalledWith(basePrompt);
  selectRenderedText(editor, "walks");
  typeRenderedText(editor, "x".repeat(basePrompt.length));
  expect(screen.getByRole("alert")).toHaveTextContent("长度上限");
  expect(changes).toHaveBeenCalledTimes(2);
});

test("the screenshot's singular subject heading restores numbered subjects and keeps image references separate", () => {
  const value =
    "subject_definition: <Picture 1> is the opening frame.\n<Subject 1> is Faris as drawn in <Picture 1>.\nsummary\nAnimate the first frame.\ndetailed_description\n[Shot 1] <Subject 1> turns.";
  const file = media("faris", "image");
  const onChange = vi.fn();
  render(
    <GenerationPromptField
      {...props}
      assets={[file]}
      referenceSlots={{ picture: [file.id] }}
      value={value}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("heading", { name: "主体定义" })).toBeVisible();
  for (const button of screen.getAllByRole("button", { name: "查看主体1" })) {
    expect(button).toHaveTextContent("主体1");
    expect(button.querySelector("[data-media-id], img")).toBeNull();
  }
  expect(
    screen
      .getAllByRole("button", { name: "查看图片1" })[0]
      .querySelector("[data-media-id]"),
  ).toHaveAttribute("data-media-id", file.id);
  expect(reassemble(value)).toBe(value);
  expect(onChange).not.toHaveBeenCalled();
});

test("ordinary descriptions, quoted text and spoken speaker IDs do not create extra labels or associations", () => {
  const value =
    'subject_definitions:\n<Subject 1> is Faris as drawn in <Picture 1> and <Video 1>.\ndetailed_description:\n[Shot 1] Subject 2 and Video 2 are ordinary words. The camera pushes in toward a sign reading "营业中". She says <d>[English] I said (S9), [portrait.png].</d>';
  const document = resolvePromptRendering(value)!.document;
  const file = media("portrait", "image");
  const options = h3PromptMentions(document, [file], { picture: [file.id] });
  expect(options.filter((item) => item.kind === "speaker")).toEqual([]);
  expect(options.find((item) => item.kind === "subject")).toMatchObject({
    label: "主体1",
    source: "<Subject 1>",
  });
  expect(options.find((item) => item.kind === "subject")?.file).toBeUndefined();
  render(
    <GenerationPromptField
      {...props}
      value={value}
      onChange={vi.fn()}
      assets={[file]}
      referenceSlots={{ picture: [file.id] }}
    />,
  );
  const editor = screen.getByRole("textbox");
  expect(screen.getByRole("button", { name: "查看主体1" })).toHaveTextContent(
    "主体1",
  );
  expect(
    editor.querySelector(
      '.prompt-reference[data-reference-kind="subject"] [data-media-id]',
    ),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "查看主体2" })).toBeNull();
  expect(screen.queryByRole("button", { name: "查看视频2" })).toBeNull();
  expect(editor).toHaveTextContent("Subject 2 and Video 2 are ordinary words.");
  expect(
    editor.querySelector(".is-speaker, .is-camera, .is-screen-text"),
  ).toBeNull();
  expect(screen.getByLabelText("对白或歌词")).toHaveTextContent(
    "[portrait.png]",
  );
  expect(
    screen
      .getByLabelText("对白或歌词")
      .querySelector("[data-media-id], .prompt-reference"),
  ).toBeNull();
  expect(reassemble(value)).toBe(value);
});

test.each([
  "subject_definitions\n",
  "subject_definitions:\n",
  "subject_definitions:\r\n",
])(
  "backspace at the first body character preserves %s and subsequent Enter keeps rendering",
  (heading) => {
    const original =
      heading +
      "<Subject 1> is Faris in <Picture 1>.\nsummary\nA walk.\ndetailed_description\n[Shot 1] She walks.";
    const changes = vi.fn();
    function Harness() {
      const [value, setValue] = useState(original);
      return (
        <GenerationPromptField
          {...props}
          value={value}
          onChange={(next) => {
            changes(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    const editor = screen.getByRole("textbox");
    act(() => editor.focus());
    fireEvent.keyDown(editor, { key: "Home", ctrlKey: true });
    for (let index = 0; index < 5; index++)
      fireEvent.keyDown(editor, { key: "Backspace" });
    expect(changes).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "主体定义" })).toBeVisible();
    fireEvent.keyDown(editor, { key: "Enter" });
    typeRenderedText(editor, "Added");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(changes).toHaveBeenLastCalledWith(
      heading + "\nAdded\n" + original.slice(heading.length),
    );
    expect(screen.getByRole("button", { name: "查看主体1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "主体定义" })).toBeVisible();
  },
);

test("deletion and replacement across sections preserve their hidden field names and mandatory separators", () => {
  const value =
    "subject_definitions\nAlpha.\nsummary:\nBeta.\ndetailed_description\n[Shot 1] Gamma.";
  const document = resolvePromptRendering(value)!.document;
  const ranges = h3ProtectedSource(document, value);
  const end = value.indexOf("\nsummary");
  expect(
    editH3Source(value, { start: end, end: end + 1 }, "", ranges).value,
  ).toBe(value);
  const replaced = editH3Source(
    value,
    { start: value.indexOf("Alpha"), end: value.indexOf("Beta.") + 5 },
    "Changed.",
    ranges,
  ).value;
  expect(replaced).toBe(
    "subject_definitions\nChanged.\nsummary:\n\ndetailed_description\n[Shot 1] Gamma.",
  );
  expect(
    resolvePromptRendering(replaced)!.document.sections.map(
      (section) => section.field,
    ),
  ).toEqual(["subject_definitions", "summary", "detailed_description"]);
  expect(
    editH3Source(
      value,
      { start: 0, end: value.length },
      "replacement",
      ranges,
      true,
    ).value,
  ).toBe("replacement");
});

test("backspace after dialogue deletes the visible character while keeping the hidden closing tag", () => {
  const original =
    "detailed_description:\n[Shot 1] She says <d>[Chinese] 你好！</d>\noverall_soundscape: Wind.";
  const changes = vi.fn();
  function Harness() {
    const [value, setValue] = useState(original);
    return (
      <GenerationPromptField
        {...props}
        value={value}
        onChange={(next) => {
          changes(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const editor = screen.getByRole("textbox");
  selectRenderedText(editor, "你好！");
  const range = window.getSelection()!.getRangeAt(0);
  range.collapse(false);
  fireEvent.mouseUp(editor);
  fireEvent.keyDown(editor, { key: "Backspace" });
  expect(changes).toHaveBeenLastCalledWith(original.replace("你好！", "你好"));
  expect(screen.getByRole("heading", { name: "环境声与音效" })).toBeVisible();
  expect(copiedEditorSource(editor)).toBe(original.replace("你好！", "你好"));
});
