import { test, type TestInfo } from "@playwright/test";

export function proofStep(
  info: TestInfo,
  title: string,
  expected: string,
  run: () => Promise<void>,
) {
  return test.step(title, async () => {
    await info.attach(`${title}.expectation.json`, {
      body: Buffer.from(JSON.stringify({ checkpoint: title, expected })),
      contentType: "application/json",
    });
    await run();
  });
}
