import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { components } from "../src/generated/api";

type Run = components["schemas"]["AcceptanceRunOut"];
export const acceptanceScreens = resolve("../.local/acceptance/node-ui");
export async function acceptanceProject(page: Page, references = true) {
  mkdirSync(acceptanceScreens, { recursive: true });
  const videoPath = resolve(acceptanceScreens, `synthetic-${process.pid}.mp4`);
  const visualReference = process.env.FPL_E2E_ACCEPTANCE_IMAGE;
  execFileSync("ffmpeg", [
    "-v",
    "error",
    ...(visualReference
      ? [
          "-loop",
          "1",
          "-framerate",
          "12",
          "-i",
          visualReference,
          "-vf",
          "scale=400:-2",
        ]
      : ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12"]),
    "-t",
    visualReference ? "8" : "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    videoPath,
  ]);
  const video = readFileSync(videoPath);
  const image = visualReference
    ? readFileSync(visualReference)
    : Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "节点验收交互测试", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).id,
    base = `/v1/visual-workshop/projects/${id}`;
  const upload = async (buffer: Buffer, name: string, mimeType: string) => {
    const r = await page.request.post("/v1/files", {
      headers,
      multipart: { project_id: id, upload: { name, mimeType, buffer } },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).id as string;
  };
  const character = await upload(image, "角色基准图.png", "image/png"),
    motion = await upload(video, "原动作.mp4", "video/mp4");
  const canvas = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        {
          id: "shot",
          kind: "video",
          title: "动作迁移镜头",
          position: { x: 0, y: 0 },
          generation_draft: {
            mode: "reference",
            prompt: "保持角色外观，复现参考动作",
            ratio: "adaptive",
            duration: -1,
            reference_asset_ids: references ? [character] : [],
            video_asset_ids: references ? [motion] : [],
          },
        },
      ],
      edges: [],
    },
  });
  expect(canvas.ok(), await canvas.text()).toBeTruthy();
  const add = async () => {
    const c = await (await page.request.get(`${base}/canvas`)).json();
    const r = await page.request.post(`${base}/nodes/shot/output-uploads`, {
      headers,
      multipart: {
        expected_revision: String(c.revision),
        file: { name: "输出.mp4", mimeType: "video/mp4", buffer: video },
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await (await page.request.get(`${base}/nodes/shot/outputs`)).json())
      .items[0];
  };
  const output = await add();
  return { id, base, headers, character, output, add };
}

// Only external execution/review responses are simulated. Node settings, media,
// binding CAS and navigation use the isolated application's real HTTP endpoints.
export async function simulatedInspection(
  page: Page,
  base: string,
  character: string,
) {
  const records: Run[] = [];
  const catalogResponse = await page.request.get(
      "/v1/visual-workshop/acceptance/catalog",
    ),
    catalog = await catalogResponse.json();
  catalog.items[0].schemes.forEach(
    (s: {
      available: boolean;
      message: string;
      connection_label: string;
      model_slug: string;
    }) =>
      Object.assign(s, {
        available: true,
        message: "测试连接已就绪",
        connection_label: "测试视觉模型",
        model_slug: "fake-vision-v1",
      }),
  );
  catalog.items[0].schemes.forEach(
    (s: {
      kind: string;
      provider_kind: string;
      connection_label: string;
      model_slug: string;
      id: string;
    }) => {
      if (s.kind === "model_api") s.provider_kind = "openai";
      else {
        s.connection_label = s.id.endsWith(":codex") ? "Codex" : "Claude Code";
        s.model_slug = "";
      }
    },
  );
  await page.route("**/v1/visual-workshop/acceptance/catalog", (r) =>
    r.fulfill({ json: catalog }),
  );
  await page.route(`**${base}/nodes/shot/acceptance*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(),
      value = await response.json();
    value.issues = value.issues.filter(
      (issue: string) => !issue.includes("固定视觉模型"),
    );
    value.current_run =
      records.find((r) => r.output_id === value.output_id) ?? null;
    value.result_is_current = !!value.current_run;
    await route.fulfill({ json: value });
  });
  await page.route(`**${base}/nodes/shot/acceptance/runs`, async (route) => {
    const body = route.request().postDataJSON();
    const output = (
      await (await page.request.get(`${base}/nodes/shot/outputs`)).json()
    ).items.find((i: { id: string }) => i.id === body.output_id);
    const context = await (
      await page.request.get(
        `${base}/nodes/shot/acceptance?output_id=${body.output_id}`,
      )
    ).json();
    const run: Run = {
      id: `fake-${records.length}`,
      node_id: "shot",
      output_id: body.output_id,
      previous_run_id: body.previous_run_id,
      model_id: null,
      standard_version: 1,
      scheme_id: "motion-transfer:api",
      status: "completed",
      decision: "pending",
      revision: 1,
      created_at: new Date().toISOString(),
      error_message: null,
      snapshot: {
        standard_version: 1,
        standard_title: "动作迁移",
        scheme_id: "motion-transfer:api",
        context_fingerprint: body.context_fingerprint,
        input_source: "node_settings",
        inputs_version: 1,
        scheme_version: 1,
        result_contract_version: 1,
        inputs: { assets: context.inputs },
        prompt: "保持角色外观，复现参考动作",
        coverage: "仅检查抽样帧，连续动作需要人工完整播放确认。",
        criteria: catalog.items[0].criteria,
        output: {
          id: output.id,
          version: output.version,
          kind: "video",
          asset_id: output.asset_id,
          text: null,
          title: "动作迁移镜头",
        },
        metadata: {
          duration_ms: process.env.FPL_E2E_ACCEPTANCE_IMAGE ? 8000 : 1000,
        },
        check_results: [],
      },
      evidence: [
        {
          id: "frame",
          asset_id: character,
          source_asset_id: output.asset_id,
          position_ms: 0,
        },
      ],
      decisions: [],
      results: catalog.items[0].criteria.map(
        (c: { id: string; method: "ai" | "manual" | "automatic" }) => ({
          criterion_id: c.id,
          verdict: c.method === "automatic" ? "passed" : "pending",
          origin: c.method,
          suggestion: c.method === "ai" ? "passed" : undefined,
          explanation: c.method === "ai" ? "抽样建议通过" : "等待人工确认",
          evidence_ids: c.method === "ai" ? ["frame"] : [],
        }),
      ),
    };
    run.snapshot.check_results = structuredClone(run.results);
    records.unshift(run);
    await route.fulfill({ json: run });
  });
  await page.route(`**${base}/acceptance/runs**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/runs"))
      return route.fulfill({ json: { items: records } });
    const run = records.find((r) => path.includes(`/runs/${r.id}`));
    if (!run) return route.continue();
    if (path.endsWith("/decisions")) {
      const body = route.request().postDataJSON();
      if (body.finalize)
        run.decision = run.results.some((r) => r.verdict === "failed")
          ? "failed"
          : "passed";
      else {
        Object.assign(
          run.results.find((r) => r.criterion_id === body.criterion_id)!,
          { verdict: body.verdict },
        );
        run.decision = "pending";
      }
      run.decisions.push(body);
      run.revision++;
    }
    if (path.endsWith("/repair-drafts"))
      return route.fulfill({
        json: {
          id: "repair",
          run_id: run.id,
          text: "返修要求：道具接触异常",
          revision: 0,
          prompt_version_id: null,
        },
      });
    return route.fulfill({ json: run });
  });
  await page.route(`**${base}/acceptance/summary`, async (route) => {
    const response = await route.fetch(),
      value = await response.json();
    value.items.forEach(
      (item: { node_id: string; state: string; issue: string; run?: Run }) => {
        if (records[0] && item.node_id === "shot") {
          item.run = records[0];
          item.state = records[0].decision;
          item.issue = String(
            [...records[0].decisions]
              .reverse()
              .find((d) => d.verdict === "failed" && d.reason)?.reason ?? "",
          );
        }
      },
    );
    await route.fulfill({ json: value });
  });
  return () => records;
}
