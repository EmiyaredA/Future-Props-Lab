import { expect, test } from "@playwright/test";
import {
  workbenchEntries,
  workbenchSessions,
} from "./fixtures/agent-workbench";

// All transcript and file payloads are deterministic fixtures; no real project,
// native agent or desktop is accessed by this journey.
test("cloud reader keeps file navigation inside the Agent view", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1616, height: 1000 });
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        host_label: "Mac",
        local: true,
        desktop_configured: false,
        desktop_authorized: false,
        idle_minutes: 120,
        idle_revision: 0,
        unlocked_until: Math.floor(Date.now() / 1000) + 600,
      },
    }),
  );
  await page.route("**/v1/agent-workbench/execution/catalog", (route) =>
    route.fulfill({ json: { enabled: true, projects: [], agents: [] } }),
  );
  await page.route("**/v1/agent-workbench/chats", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/v1/agent-workbench/sessions?*", (route) =>
    route.fulfill({
      json: {
        items: [workbenchSessions[0]],
        next_cursor: null,
        change_cursor: 1,
      },
    }),
  );
  await page.route("**/v1/agent-workbench/sources", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/v1/agent-workbench/**/events*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: ": heartbeat\n\n",
    }),
  );
  await page.route("**/v1/agent-workbench/events*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: ": heartbeat\n\n",
    }),
  );
  await page.route("**/v1/agent-workbench/sessions/fixture-0", (route) =>
    route.fulfill({ json: { ...workbenchSessions[0], agent_id: "codex" } }),
  );
  const entries = workbenchEntries();
  await page.route(
    "**/v1/agent-workbench/sessions/fixture-0/history?*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            entries[0],
            {
              ...entries[1],
              text: "正在检查预览状态。可以在旁边打开 [Preview.tsx](src/Preview.tsx:3) 核对实现。",
            },
            {
              ...entries[2],
              id: "call",
              native_id: "call:one",
              kind: "tool_call",
              tool_name: "exec",
              text: 'const results = await Promise.allSettled([tools.exec_command({cmd: "rg -n preview src/Preview.tsx && npm run test -- --run preview --reporter=verbose"})]);\nresults.forEach(result => text(result.value));',
              presentation: { call_id: "one" },
            },
            {
              ...entries[2],
              id: "result",
              native_id: "result:one",
              ordinal: 3,
              tool_name: "",
              text: "PASS src/Preview.tsx\nAll 12 checks passed.",
              presentation: { call_id: "one" },
            },
            { ...entries[3], ordinal: 4 },
          ],
          next_cursor: null,
          change_cursor: 1,
        },
      }),
  );
  const requests: string[] = [];
  await page.route(
    "**/v1/agent-workbench/sessions/fixture-0/source?*",
    (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        json: {
          path: "src/Preview.tsx",
          line: 3,
          diff: null,
          text:
            'import { useEffect, useState } from "react";\n\nexport function Preview({ file }: { file: File }) {\n  const [url, setUrl] = useState("");\n  useEffect(() => {\n    const next = URL.createObjectURL(file);\n    setUrl(next);\n    return () => URL.revokeObjectURL(next);\n  }, [file]);\n  return <img src={url} alt="Preview" />;\n}' +
            "\n// Additional source line".repeat(100),
        },
      });
    },
  );
  await page.goto("/cloud-control");
  const switcher = page.getByRole("group", { name: "云控视图" });
  const desktopTab = switcher.getByRole("button", { name: "远程桌面" });
  const agentTab = switcher.getByRole("button", { name: "Agent 工作台" });
  await agentTab.click();
  await page.getByRole("button", { name: "会话历史" }).click();
  await page
    .getByRole("button", { name: workbenchSessions[0].title, exact: true })
    .click();
  await page.getByText("运行了命令", { exact: true }).click();
  await page.getByText("exec", { exact: true }).click();
  const script = page.getByLabel("JavaScript", { exact: true });
  await expect(script).toBeVisible();
  await expect(script).toHaveCSS("white-space", "pre");
  await expect(
    page.getByRole("button", { name: "result.value", exact: true }),
  ).toHaveCount(0);
  await page.getByText("exec", { exact: true }).hover();
  await page.getByRole("button", { name: "Preview.tsx", exact: true }).click();
  const reader = page.getByRole("complementary", { name: "源码预览" });
  await expect(
    reader.getByText("src/Preview.tsx", { exact: true }),
  ).toBeVisible();
  expect(new URL(requests[0]).searchParams.get("line")).toBe("3");
  const sourceCode = reader.getByLabel("当前文件内容");
  const scrollBefore = await sourceCode.evaluate((node) => {
    node.scrollTop = 400;
    return node.scrollTop;
  });
  expect(scrollBefore).toBeGreaterThan(0);
  const fileRequestCount = requests.length;
  await desktopTab.click();
  await expect(reader).toBeHidden();
  await agentTab.click();
  await expect(sourceCode).toBeVisible();
  expect(await sourceCode.evaluate((node) => node.scrollTop)).toBe(
    scrollBefore,
  );
  expect(requests).toHaveLength(fileRequestCount);
  await expect(sourceCode).toHaveAttribute("data-language", "typescript");
  await expect(sourceCode.locator(".hljs-keyword").first()).toHaveText(
    "import",
  );
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const colors = await sourceCode.evaluate((node) => ({
      body: getComputedStyle(node).color,
      keyword: getComputedStyle(node.querySelector(".hljs-keyword")!).color,
    }));
    expect(colors.keyword).not.toBe(colors.body);
    await page.screenshot({
      path: testInfo.outputPath(`agent-reader-${theme}.png`),
      fullPage: true,
    });
  }
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(reader).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("mobile-reader.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1616, height: 1000 });
  await page.getByRole("button", { name: "关闭源码" }).click();
  await expect(
    page.getByRole("button", { name: "Preview.tsx", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(agentTab).toHaveAttribute("aria-pressed", "true");
});
