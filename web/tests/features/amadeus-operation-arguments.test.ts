import { describe, expect, it } from "vitest";
import { normalizeOperationBody } from "../../src/features/amadeus/operationArguments";

describe("Amadeus registered operation body", () => {
  it("turns model generated JSON text into the object shown for approval", () => {
    const body = {
      expected_revision: 8,
      request_id: "maid-turnaround-20260927-01",
      operations: [{ action: "insert", entity: "node", id: "new-node" }],
    };
    expect(normalizeOperationBody(JSON.stringify(body))).toEqual(body);
    expect(normalizeOperationBody(body)).toBe(body);
  });

  it("rejects non-object JSON before an approval is proposed", () => {
    expect(() => normalizeOperationBody("not JSON")).toThrow("JSON 对象");
    expect(() => normalizeOperationBody("[1, 2]")).toThrow("JSON 对象");
    expect(() => normalizeOperationBody('"text"')).toThrow("JSON 对象");
  });
});
