// Run the shipped CLI against a real isolated App, approving only test credentials.
const { spawn } = require("node:child_process");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");

function cliFor(executable, dataDirectory) {
  const binary = path.resolve(path.dirname(executable), "../Resources/fpl/fpl");
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, ["--data-dir", dataDirectory, ...args], {
        cwd: "/tmp",
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      child.on("error", reject);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("CLI test timed out"));
      }, 45000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`CLI exit ${code}: ${stderr}`));
        else resolve(JSON.parse(stdout));
      });
      child.stdin.end(input === undefined ? "" : JSON.stringify(input));
    });
}

async function verifyAgent(
  application,
  page,
  executable,
  dataDirectory,
  evidence,
  passed,
) {
  const cli = cliFor(executable, dataDirectory);
  const status = await page.evaluate(() =>
    window.futurePropsDesktop.agentStatus(),
  );
  assert.equal(status.enabled, false);
  await page.evaluate(() => window.futurePropsDesktop.enableAgent());
  const connection = cli(["connect", "--name", "CLI 安装验收", "--write"]);
  // Attach a handler immediately; the rejection is still awaited below.
  connection.catch(() => {});
  await expect(
    page.getByRole("heading", { name: "允许「CLI 安装验收」接入？" }),
  ).toBeVisible({ timeout: 20000 });
  await page.screenshot({
    path: path.join(evidence, "agent-approval-light.png"),
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: path.join(evidence, "agent-approval-dark.png"),
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("button", { name: "核对一致，允许接入" }).click();
  assert.equal((await connection).status, "approved");
  const ready = await cli(["status"]);
  assert.equal(ready.workspace_id, "default");
  passed("shipped CLI pairs through App approval with system-only PATH");
  const project = await cli(["call", "visual.create_project", "--input", "-"], {
    body: { title: "CLI 创建的作品", kind: "image" },
  });
  await expect(
    page.getByText("Agent 已更新工作区内容。刷新前会检查尚未保存的编辑。"),
  ).toBeVisible({ timeout: 10000 });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  const opened = await cli(["open", "visual", project.id]);
  assert.equal(opened.status, "opened");
  await expect(page).toHaveURL(new RegExp(project.id));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  passed(
    "CLI writes notify the UI and opening a project restores the hidden window",
  );
  return async () => {
    const restored = await cli(["status"]);
    assert.equal(restored.user_id, ready.user_id);
    assert.equal(restored.workspace_id, ready.workspace_id);
    passed(
      "CLI authorization survives App restart and discovers the new socket",
    );
  };
}

module.exports = { verifyAgent };
