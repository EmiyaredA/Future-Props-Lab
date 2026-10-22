import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TemplateLibrary } from "@features/visual-workshop/acceptance/TemplateLibrary";
import { StandardEditor } from "@features/visual-workshop/acceptance/StandardEditor";
import {
  newCriterion,
  type StandardDocument,
  type Template,
} from "@features/visual-workshop/acceptance/api";
import { useState } from "react";

const template: Template = {
  id: "builtin:sample",
  title: "视频镜头通用",
  builtin: true,
  revision: 0,
  document: {
    title: "视频镜头通用",
    node_ids: [],
    criteria: [
      { ...newCriterion(), id: "rule", title: "角色外观一致", method: "ai" },
    ],
  },
};

test("template selection copies editable requirements and supports empty standards", async () => {
  const user = userEvent.setup(),
    onUse = vi.fn();
  render(
    <TemplateLibrary
      templates={[template]}
      onUse={onUse}
      onDelete={vi.fn()}
      writable
    />,
  );
  await user.click(screen.getByRole("button", { name: "使用模板并配置" }));
  expect(onUse).toHaveBeenCalledWith(template.document);
  expect(onUse.mock.calls[0][0]).not.toBe(template.document);
  await user.click(screen.getByRole("button", { name: "从空白开始" }));
  expect(onUse.mock.lastCall?.[0].criteria).toEqual([]);
});

test("criterion editor configures media and prevents unsupported automatic audio analysis", async () => {
  const user = userEvent.setup();
  function Editor() {
    const [doc, setDoc] = useState<StandardDocument>(
      structuredClone(template.document),
    );
    const [required, setRequired] = useState(false);
    return (
      <StandardEditor
        document={doc}
        onChange={setDoc}
        nodes={[]}
        required={required}
        setRequired={setRequired}
        writable
      />
    );
  }
  render(<Editor />);
  const requirement = screen.getByLabelText("具体要求");
  await user.type(requirement, "眼镜和发型保持一致");
  expect(requirement).toHaveValue("眼镜和发型保持一致");
  await user.click(screen.getByLabelText("音频"));
  expect(screen.getByRole("combobox", { name: "检查方式" })).toHaveTextContent(
    "人工确认",
  );
  await user.click(screen.getByRole("combobox", { name: "检查方式" }));
  expect(screen.getByRole("option", { name: "自动检查" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByLabelText("强制验收后才能采用输出"));
  expect(screen.getByLabelText("强制验收后才能采用输出")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "添加验收项" }));
  expect(screen.getByLabelText("验收项名称")).toHaveValue("自定义验收项");
});

test("read-only standards disable inputs and all mutations", () => {
  render(
    <StandardEditor
      document={template.document}
      onChange={vi.fn()}
      nodes={[]}
      required={false}
      setRequired={vi.fn()}
      writable={false}
    />,
  );
  expect(screen.getByLabelText("标准名称")).toBeDisabled();
  expect(screen.getByRole("button", { name: "添加验收项" })).toBeDisabled();
  expect(screen.getByLabelText("验收项名称")).toBeDisabled();
});
