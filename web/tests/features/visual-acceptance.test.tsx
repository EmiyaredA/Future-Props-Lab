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
  id: "builtin:motion-transfer",
  title: "动作迁移",
  builtin: true,
  revision: 0,
  document: {
    title: "动作迁移",
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
  expect(
    screen.getByRole("button", { name: /动作迁移.*复现原视频动作/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/准备角色基准图和原动作视频/)).toBeVisible();
  expect(
    screen.getByText(/连续动作、节奏与音画同步需人工完整播放核对/),
  ).toBeVisible();
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
  expect(screen.getByRole("radio", { name: "人工确认" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "自动检查" })).toBeDisabled();
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

test("template filters search requirements and separate real workspace templates", async () => {
  const user = userEvent.setup();
  const image = {
    ...template,
    document: {
      ...template.document,
      criteria: [
        { ...newCriterion(), title: "外观", requirement: "眼镜与发型一致" },
      ],
    },
  };
  const audio: Template = {
    ...template,
    id: "voice",
    title: "台词验收",
    builtin: false,
    document: {
      title: "台词验收",
      criteria: [
        { ...newCriterion(), kinds: ["audio"], requirement: "声音清晰" },
      ],
    },
  };
  render(
    <TemplateLibrary
      templates={[image, audio]}
      onUse={vi.fn()}
      onDelete={vi.fn()}
      writable
    />,
  );
  await user.type(screen.getByLabelText("搜索验收模板"), "眼镜");
  expect(screen.getByRole("heading", { name: "动作迁移" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "台词验收" }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("搜索验收模板"));
  await user.click(screen.getByRole("radio", { name: "音频" }));
  expect(screen.getByRole("heading", { name: "台词验收" })).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("台词验收");
  await user.type(screen.getByLabelText("搜索验收模板"), "无此要求");
  expect(
    screen.getByText("没有匹配的模板。调整搜索或媒体筛选后再试。"),
  ).toBeVisible();
});

test("inspection method segments support arrow keys and level selection", async () => {
  const user = userEvent.setup();
  function Editor() {
    const [doc, setDoc] = useState<StandardDocument>(
      structuredClone(template.document),
    );
    return (
      <StandardEditor
        document={doc}
        onChange={setDoc}
        nodes={[]}
        required={false}
        setRequired={vi.fn()}
        writable
      />
    );
  }
  render(<Editor />);
  screen.getByRole("radio", { name: "AI 辅助" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "人工确认" })).toBeChecked();
  await user.keyboard("{Home}");
  expect(screen.getByRole("radio", { name: "自动检查" })).toBeChecked();
  expect(screen.getByLabelText("最小宽度")).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "建议满足" }));
  expect(screen.getByRole("radio", { name: "建议满足" })).toBeChecked();
});
