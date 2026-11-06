import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FormulaDialog from "@features/presentation-workshop/objects/formula/FormulaDialog";
import { formulaGeometry } from "@features/presentation-workshop/objects/formula/formulaGeometry";
import {
  cosineFormula,
  formulaTemplates,
} from "@features/presentation-workshop/objects/formula/formulaTemplates";
import {
  useFormulaPreview,
  type Formula,
} from "@features/presentation-workshop/objects/formula/useFormulaPreview";
import { useObjectEditor } from "@features/presentation-workshop/objects/useObjectEditor";
import { newObject } from "@features/presentation-workshop/objects/objectDefaults";
import { newDeck } from "@features/presentation-workshop/templates";
import type {
  Draft,
  SlideElement,
} from "@features/presentation-workshop/types";
import { uploadImage } from "@features/presentation-workshop/api";
import { formulaSvg } from "@features/presentation-workshop/objects/formulaSvg";

vi.mock("@features/presentation-workshop/api", () => ({
  uploadImage: vi.fn(),
}));
vi.mock("@features/presentation-workshop/objects/formulaSvg", () => ({
  formulaSvg: vi.fn(),
}));
const drawing = (f: Formula) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${f.size * 4}" height="${f.size}"><path fill="${f.color}" d="M0 0h1v1z"/></svg>`;
beforeEach(() => {
  vi.mocked(formulaSvg)
    .mockReset()
    .mockImplementation(async (f) => drawing(f));
  vi.mocked(uploadImage)
    .mockReset()
    .mockResolvedValue({ id: "svg-asset" } as Awaited<
      ReturnType<typeof uploadImage>
    >);
});
const pageSize = { width: 1280, height: 720 };
function open(initial?: SlideElement) {
  const onApply = vi.fn(),
    onClose = vi.fn();
  const view = render(
    <FormulaDialog
      initial={initial}
      pageSize={pageSize}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return {
    ...view,
    onApply,
    onClose,
    source: screen.getByRole("textbox", {
      name: "LaTeX 公式",
    }) as HTMLTextAreaElement,
    submit: screen.getByRole("button", {
      name: initial ? "应用修改" : "插入公式",
    }),
  };
}

it.each(formulaTemplates)(
  "$label wraps the input selection without changing other content",
  async (template) => {
    const { source, onApply } = open();
    fireEvent.change(source, { target: { value: "a+x+b" } });
    source.focus();
    source.setSelectionRange(2, 3);
    fireEvent.select(source);
    fireEvent.click(
      screen.getByRole("button", {
        name: `插入${template.label}`,
      }),
    );
    expect(source.value).toBe(`a+${template.wrap("x")}+b`);
    expect(source).toHaveFocus();
    expect(source.value.slice(source.selectionStart, source.selectionEnd)).toBe(
      template.wrap("x"),
    );
    expect(onApply).not.toHaveBeenCalled();
  },
);

it("inserts at the caret, replaces with a preset and cancels without uploading", async () => {
  const { source, submit, onClose, onApply } = open();
  expect(source.value).toBe("E = mc^2");
  expect(submit).toBeDisabled();
  source.focus();
  source.setSelectionRange(1, 1);
  fireEvent.select(source);
  fireEvent.click(screen.getByRole("button", { name: "插入根号" }));
  expect(source.value).toBe(String.raw`E\sqrt{x} = mc^2`);
  fireEvent.click(screen.getByRole("button", { name: "余弦相似度" }));
  expect(source.value).toBe(cosineFormula);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(uploadImage).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});

it("uses the current rendered SVG for upload and retains the draft after an upload failure", async () => {
  const { source, submit, onApply } = open();
  fireEvent.click(screen.getByRole("button", { name: "余弦相似度" }));
  await waitFor(() => expect(submit).toBeEnabled());
  const svg = decodeURIComponent(
    screen.getByAltText("公式实时预览").getAttribute("src")!.split(",")[1],
  );
  vi.mocked(uploadImage).mockRejectedValueOnce(new Error("上传暂时失败"));
  fireEvent.click(submit);
  await screen.findByText("上传暂时失败");
  expect(source.value).toBe(cosineFormula);
  expect(onApply).not.toHaveBeenCalled();
  const file = vi.mocked(uploadImage).mock.calls[0][0];
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
  expect(text).toBe(svg);
  fireEvent.click(submit);
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  expect(onApply.mock.calls[0][0]).toMatchObject({
    kind: "formula",
    asset_id: "svg-asset",
    width: 144,
    height: 36,
    formula: { latex: cosineFormula },
  });
});

it("disables submission for empty or invalid formulas and recovers after correction", async () => {
  const { source, submit } = open();
  fireEvent.change(source, { target: { value: "  " } });
  await screen.findByText("请输入公式，或选择一个模板");
  expect(submit).toBeDisabled();
  vi.mocked(formulaSvg).mockImplementation(async (f) => {
    if (f.latex === "invalid") throw new Error("公式语法错误");
    return drawing(f);
  });
  fireEvent.change(source, { target: { value: "invalid" } });
  await screen.findByText("公式语法错误");
  expect(submit).toBeDisabled();
  fireEvent.change(source, { target: { value: "x^2" } });
  await waitFor(() => expect(submit).toBeEnabled());
});

it("debounces input, ignores late renders and blocks composition from submitting stale content", async () => {
  let completeOld: (svg: string) => void = () => {};
  vi.mocked(formulaSvg).mockImplementation(async (f) =>
    f.latex === "old"
      ? new Promise<string>((resolve) => {
          completeOld = resolve;
        })
      : drawing(f),
  );
  const { result, rerender } = renderHook(
    ({ latex, composing }) =>
      useFormulaPreview({ latex, size: 36, color: "#17334A" }, 200, composing),
    { initialProps: { latex: "old", composing: false } },
  );
  expect(formulaSvg).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(formulaSvg).toHaveBeenCalledWith(
      expect.objectContaining({ latex: "old" }),
    ),
  );
  rerender({ latex: "new", composing: false });
  expect(result.current.drawing).toBeUndefined();
  await waitFor(() => expect(result.current.drawing).toBeDefined());
  const current = result.current.drawing;
  await act(async () => completeOld('<svg width="999" height="999"/>'));
  expect(result.current.drawing).toBe(current);
  rerender({ latex: "new", composing: true });
  expect(result.current.drawing).toBeUndefined();
});

it("closing during upload prevents the delayed result from committing", async () => {
  let finish: (
    asset: Awaited<ReturnType<typeof uploadImage>>,
  ) => void = () => {};
  vi.mocked(uploadImage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { submit, onApply, unmount } = open();
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  expect(uploadImage).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  unmount();
  await act(async () =>
    finish({ id: "late" } as Awaited<ReturnType<typeof uploadImage>>),
  );
  expect(onApply).not.toHaveBeenCalled();
});

it("editing changes size with the user's existing scale and preserves other properties", async () => {
  const initial = {
    ...newObject("formula"),
    asset_id: "old",
    x: 10,
    y: 20,
    width: 288,
    height: 72,
    rotation: 17,
  };
  const { submit, onApply } = open(initial);
  fireEvent.change(screen.getByRole("spinbutton", { name: "公式字号" }), {
    target: { value: "72" },
  });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  expect(onApply.mock.calls[0][0]).toMatchObject({
    id: initial.id,
    x: 10,
    y: 20,
    width: 576,
    height: 144,
    rotation: 17,
    formula: { size: 72 },
  });
});

it("new formulas fit small pages without stretching or changing their source", () => {
  const result = formulaGeometry(
    newObject("formula"),
    { svg: "", width: 1000, height: 500 },
    { width: 320, height: 240 },
  );
  expect(result.x + result.width).toBeLessThanOrEqual(320);
  expect(result.y + result.height).toBeLessThanOrEqual(240);
  expect(result.width / result.height).toBe(2);
});

function EditorHarness({
  readOnly = false,
  initial,
  commit,
}: {
  readOnly?: boolean;
  initial: SlideElement;
  commit: (update: (d: Draft) => Draft) => void;
}) {
  const document = newDeck("blank");
  document.slides[0].id = "slide";
  document.slides[0].elements = [initial];
  const objects = useObjectEditor({
    slideId: "slide",
    readOnly,
    current: () => ({ title: "Test", document }),
    commit,
    select: () => {},
  });
  return (
    <>
      <button onClick={objects.insertFormula}>新公式</button>
      <button onClick={() => objects.edit(initial)}>编辑已有公式</button>
      {objects.dialog}
    </>
  );
}

it("read-only and locked objects cannot open the formula editor, and revoking edit access drops an upload", async () => {
  const initial = {
    ...newObject("formula"),
    asset_id: "original",
    locked: true,
  };
  const commit = vi.fn();
  const view = render(
    <EditorHarness initial={initial} readOnly commit={commit} />,
  );
  fireEvent.click(screen.getByText("新公式"));
  fireEvent.click(screen.getByText("编辑已有公式"));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<EditorHarness initial={initial} commit={commit} />);
  fireEvent.click(screen.getByText("编辑已有公式"));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("新公式"));
  const submit = await screen.findByRole("button", {
    name: "插入公式",
  });
  await waitFor(() => expect(submit).toBeEnabled());
  let finish: (
    value: Awaited<ReturnType<typeof uploadImage>>,
  ) => void = () => {};
  vi.mocked(uploadImage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(submit);
  view.rerender(<EditorHarness initial={initial} readOnly commit={commit} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () =>
    finish({ id: "late" } as Awaited<ReturnType<typeof uploadImage>>),
  );
  expect(commit).not.toHaveBeenCalled();
});

it("a legacy formula with invalid source can be repaired without losing its position", async () => {
  const initial = {
    ...newObject("formula"),
    asset_id: "legacy",
    x: 40,
    y: 50,
    rotation: 25,
    formula: { latex: "invalid", size: 36, color: "#17334A" },
  };
  vi.mocked(formulaSvg).mockImplementation(async (f) => {
    if (f.latex === "invalid") throw new Error("旧公式无法解析");
    return drawing(f);
  });
  const { source, submit, onApply } = open(initial);
  await screen.findByText("原公式无法解析，修正后将按原对象框调整尺寸。");
  fireEvent.change(source, { target: { value: "x^2" } });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  expect(onApply.mock.calls[0][0]).toMatchObject({
    x: 40,
    y: 50,
    rotation: 25,
    formula: { latex: "x^2" },
  });
});
