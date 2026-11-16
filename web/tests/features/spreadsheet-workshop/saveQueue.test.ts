import { describe, expect, it } from "vitest";
import { SaveQueue } from "@features/spreadsheet-workshop/saveQueue";
import { snapshot } from "@features/spreadsheet-workshop/codec";
import type {
  Document,
  Project,
  Save,
} from "@features/spreadsheet-workshop/api";

const document: Document = {
  schema_version: 1,
  sheets: [
    {
      id: "one",
      name: "Sheet1",
      row: 100,
      column: 26,
      celldata: [],
      config: {},
      order: 0,
      status: 1,
    },
  ],
};
const project: Project = {
  id: "project",
  title: "原稿",
  document,
  revision: 0,
  calculation: "not_needed",
  created_at: "2026-11-16",
  updated_at: "2026-11-16",
};

function saved(body: Save): Project {
  return { ...project, ...body, revision: body.expected_revision + 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("serialized spreadsheet saves", () => {
  it("reopens the first visible sheet when the leading sheet is hidden", () => {
    const output = snapshot([
      { id: "hidden", name: "Hidden", hide: 1, order: 0, status: 1 },
      { id: "visible", name: "Visible", order: 1, status: 0 },
    ]);
    expect(output.sheets.map((sheet) => sheet.status)).toEqual([0, 1]);
  });
  it("keeps edits made while an earlier save is still in flight", async () => {
    const first = deferred<Project>();
    const calls: Save[] = [];
    const queue = new SaveQueue(project, (body) => {
      calls.push(body);
      return calls.length === 1 ? first.promise : Promise.resolve(saved(body));
    });
    queue.update("第一次编辑", document);
    const flushing = queue.flush();
    queue.update("保存中的新编辑", document);
    first.resolve(saved(calls[0]));
    await flushing;
    expect(calls.map((body) => [body.title, body.expected_revision])).toEqual([
      ["第一次编辑", 0],
      ["保存中的新编辑", 1],
    ]);
    expect(queue.project.title).toBe("保存中的新编辑");
    expect(queue.dirty).toBe(false);
  });
  it("retries the exact uncertain request before submitting later edits", async () => {
    const calls: Save[] = [];
    const queue = new SaveQueue(project, async (body) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) throw new Error("response lost after commit");
      return saved(body);
    });
    queue.update("第一稿", document);
    await expect(queue.flush()).rejects.toThrow("response lost");
    queue.update("后续编辑", document);
    await queue.flush();
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2].expected_revision).toBe(1);
    expect(calls[2].request_id).not.toBe(calls[0].request_id);
  });
  it("does not submit concurrent flush calls with the same revision", async () => {
    const pending = deferred<Project>();
    const calls: Save[] = [];
    const queue = new SaveQueue(project, (body) => {
      calls.push(body);
      return pending.promise;
    });
    queue.update("新稿", document);
    const first = queue.flush();
    const second = queue.flush();
    pending.resolve(saved(calls[0]));
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
  });
  it("ignores selection, scroll and generated display text in persisted snapshots", () => {
    const input = {
      id: "one",
      name: "Sheet1",
      row: 100,
      column: 26,
      data: [[{ v: 2, m: "2.00" }]],
      luckysheet_select_save: [{ row: [0, 0], column: [0, 0] }],
      scrollTop: 50,
      zoomRatio: 1.5,
    };
    const output = snapshot([input]);
    expect(output.sheets[0].celldata).toEqual([{ r: 0, c: 0, v: { v: 2 } }]);
    expect(output.sheets[0]).not.toHaveProperty("scrollTop");
    expect(output.sheets[0]).not.toHaveProperty("luckysheet_select_save");
    expect(output.sheets[0]).not.toHaveProperty("data");
  });
});
