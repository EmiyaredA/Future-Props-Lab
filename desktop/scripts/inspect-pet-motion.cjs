// Uses actual renderer pixels and private movement IPC in disposable Electron data.
const path = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { expect } = require("@playwright/test");

async function inspectPetMotion(studio, pet, context, projectId, directory) {
  const output = path.join(directory, "motion");
  mkdirSync(output, { recursive: true });
  const trace = [];
  const initialEnvironment = await pet.evaluate(() =>
    window.futurePropsDesktop.petEnvironment(),
  );
  await pet.evaluate(() => {
    window.motionOriginalRandom = Math.random;
  });
  const environment = () =>
    pet.evaluate(() => window.futurePropsDesktop.petEnvironment());
  const geometry = () =>
    pet.evaluate(async () => {
      const { figureGeometry } =
        await import("/src/features/desktop-pet/locomotion/measure.ts");
      const object = document.querySelector(".pet-runtime foreignObject");
      return figureGeometry(object.parentElement);
    });
  const config = await studio.evaluate(
    async (id) =>
      (await fetch(`/v1/desktop-pet/projects/${id}/document`)).json(),
    projectId,
  );
  async function save(habits) {
    await studio.evaluate(
      async ({ id, habits }) => {
        const doc = await (
          await fetch(`/v1/desktop-pet/projects/${id}/document`)
        ).json();
        const csrf = decodeURIComponent(
          document.cookie
            .split("; ")
            .find((s) => s.startsWith("fpl_csrf="))
            ?.slice(9) ?? "",
        );
        const response = await fetch(
          `/v1/desktop-pet/projects/${id}/document`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf,
            },
            body: JSON.stringify({
              expectedRevision: doc.revision,
              config: {
                ...doc.config,
                habits: { ...doc.config.habits, ...habits },
              },
            }),
          },
        );
        if (!response.ok)
          throw new Error(
            `Motion configuration: ${response.status} ${await response.text()}`,
          );
        await window.futurePropsDesktop.notifyPetResourcesChanged(id);
      },
      { id: projectId, habits },
    );
    await studio.reload();
    await studio.getByRole("button", { name: "试玩", exact: true }).waitFor();
    await pet.waitForTimeout(300);
  }
  async function place(side, high = false) {
    const g = await geometry();
    assert.ok(g);
    const result = await pet.evaluate(
      async ({ g, side, high }) => {
        const env = await window.futurePropsDesktop.petEnvironment();
        const a = env.workArea;
        const x =
          side === "left"
            ? a.x + 5 - g.visible.x
            : a.x + a.width - 5 - g.visible.x - g.visible.width;
        const y = high ? a.y + 15 - g.visible.y : a.y + a.height - 5 - g.feet.y;
        return window.futurePropsDesktop.movePetFrame({
          generation: env.generation + 1,
          sequence: 1,
          environmentRevision: env.revision,
          x,
          y,
          geometry: g,
          manual: true,
        });
      },
      { g, side, high },
    );
    await studio.evaluate(
      (id) => window.futurePropsDesktop.openPet(id),
      projectId,
    );
    return result;
  }
  try {
    await save({ roam: "off" });
    await place("left");
    let g = await geometry();
    const x = g.visible.x + g.visible.width / 2,
      y = g.visible.y + g.visible.height * 0.55;
    await pet.mouse.move(x, y);
    await pet.mouse.down();
    await expect(pet.locator(".pet-runtime")).toHaveAttribute(
      "data-motion",
      "held",
    );
    await pet.screenshot({ path: path.join(output, "held.png") });
    await pet.mouse.move(x + 65, y - 90, { steps: 12 });
    await pet.waitForTimeout(150);
    const before = await environment();
    await pet.mouse.up();
    await expect(pet.locator(".pet-runtime")).toHaveAttribute(
      "data-motion",
      "idle",
    );
    await pet.waitForTimeout(500);
    const released = await environment();
    assert.deepEqual(
      released.bounds,
      before.bounds,
      "Release must keep the confirmed placement",
    );
    trace.push({ check: "release-stays", before, after: released });
    await studio.getByRole("button", { name: "试玩", exact: true }).click();
    const toggle = studio.getByRole("switch", { name: /同步预览到桌宠/ });
    await toggle.click();
    for (const label of [
      "拎起",
      "左侧攀爬",
      "右侧攀爬",
      "向左滑翔",
      "向右滑翔",
    ]) {
      await studio.getByRole("button", { name: label, exact: true }).click();
      await expect(studio.locator(".dp-preview-details")).toContainText(
        `姿态：${label}`,
      );
      await pet.waitForTimeout(250);
      await studio.screenshot({ path: path.join(output, `demo-${label}.png`) });
      await pet.screenshot({ path: path.join(output, `linked-${label}.png`) });
    }
    await toggle.click();
    for (const side of ["left", "right"]) {
      await save({ roam: "free", edgeClimbing: true, highGliding: false });
      await pet.evaluate(
        (value) => {
          Math.random = () => value;
        },
        side === "left" ? 0.1 : 0.9,
      );
      await place(side);
      await expect(pet.locator(".pet-runtime")).toHaveAttribute(
        "data-motion",
        "climb",
        { timeout: 11000 },
      );
      const first = await environment();
      await pet.screenshot({ path: path.join(output, `${side}-climb-1.png`) });
      await pet.waitForTimeout(450);
      const next = await environment();
      assert.ok(
        next.bounds.y < first.bounds.y,
        "Climbing must continuously move upward",
      );
      await pet.screenshot({ path: path.join(output, `${side}-climb-2.png`) });
      trace.push({ check: `${side}-climb`, first, next });
    }
    await save({ roam: "free", edgeClimbing: true, highGliding: true });
    await pet.evaluate(() => {
      Math.random = () => 0.1;
    });
    await place("left", true);
    await expect(pet.locator(".pet-runtime")).toHaveAttribute(
      "data-motion",
      "glide",
      { timeout: 11000 },
    );
    const first = await environment();
    await pet.screenshot({ path: path.join(output, "glide-1.png") });
    await pet.waitForTimeout(450);
    const next = await environment();
    assert.ok(
      next.bounds.x > first.bounds.x && next.bounds.y > first.bounds.y,
      "Glide must move inward and down",
    );
    await pet.screenshot({ path: path.join(output, "glide-2.png") });
    trace.push({ check: "glide", first, next });
    await pet.evaluate(() => window.futurePropsDesktop.openPetChat());
    const chat = context.pages().find((p) => p.url().includes("pet-chat.html"));
    await expect(pet.locator(".pet-runtime")).toHaveAttribute(
      "data-motion",
      "idle",
    );
    const stopped = await environment();
    await pet.waitForTimeout(500);
    assert.deepEqual((await environment()).bounds, stopped.bounds);
    await chat
      .evaluate(() => window.futurePropsDesktop.closePetChat())
      .catch((error) => {
        if (!chat.isClosed()) throw error;
      });
    trace.push({ check: "chat-pause", stopped });
  } finally {
    await save(config.config.habits);
    await pet.evaluate(async ({ x, y }) => {
      const { figureGeometry } =
        await import("/src/features/desktop-pet/locomotion/measure.ts");
      const geometry = figureGeometry(
        document.querySelector(".pet-runtime foreignObject").parentElement,
      );
      const env = await window.futurePropsDesktop.petEnvironment();
      await window.futurePropsDesktop.movePetFrame({
        generation: env.generation + 1,
        sequence: 1,
        environmentRevision: env.revision,
        x,
        y,
        geometry,
        manual: true,
      });
      Math.random = window.motionOriginalRandom;
      delete window.motionOriginalRandom;
    }, initialEnvironment.bounds);
    await studio.evaluate(
      (id) => window.futurePropsDesktop.openPet(id),
      projectId,
    );
    writeFileSync(
      path.join(output, "trace.json"),
      JSON.stringify(trace, null, 2),
    );
  }
}
module.exports = { inspectPetMotion };

async function inspectMotionPoses(page, projectId, directory, schemeId) {
  await page.evaluate(
    async ({ id, schemeId }) => {
      const snapshot = await (
        await fetch(`/v1/desktop-pet/projects/${id}/document`)
      ).json();
      const { createHumanFigure } =
        await import("/src/features/desktop-pet/humanFigure.ts");
      const { createWhaleFigure } =
        await import("/src/features/desktop-pet/whale-vendor/whale/figure.js");
      const { createPet } =
        await import("/src/features/desktop-pet/whale-vendor/pet-core.js");
      const { demoMotion, MOTION_DEMOS } =
        await import("/src/features/desktop-pet/locomotion/demo.ts");
      const host = document.createElement("div");
      host.id = "motion-poses";
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(4,1fr);background:#eee9e1;color:#302c2b;padding:8px;gap:4px";
      document.body.append(host);
      const ns = "http://www.w3.org/2000/svg",
        figures = [];
      for (const [preset, label] of Object.entries(MOTION_DEMOS)) {
        const options = {
          model: snapshot.whaleModel,
          scheme: schemeId,
          asset: (name) => snapshot.assetUrls[snapshot.whaleAssets[name]],
        };
        const figure =
          snapshot.whaleModel.rigProfile === "human-chibi"
            ? await createHumanFigure(options)
            : await createWhaleFigure(null, options);
        figures.push(figure);
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "-40 0 336 340");
        svg.style.cssText = "width:100%;height:calc(100% - 22px)";
        const group = document.createElementNS(ns, "g"),
          shadow = document.createElementNS(ns, "ellipse"),
          fx = document.createElementNS(ns, "g");
        svg.append(shadow, group, fx);
        host.append(svg);
        const pet = createPet(
          { petG: group, shadowEl: shadow, fxG: fx },
          {
            figure,
            walkInPlace: true,
            roam: "off",
            startX: 128,
            bounds: () => ({ W: 256, H: 340, floorY: 310, S: 1 }),
            sfx: new Proxy({}, { get: () => () => {} }),
          },
        );
        for (let step = 0; step < 4; step++) {
          for (let tick = 0; tick < 12; tick++) {
            pet.setLocomotion(demoMotion(preset, (step * 12 + tick) / 30));
            pet.step(1 / 30);
            pet.render();
          }
          const canvas = group.querySelector("canvas");
          const pixels = document.createElement("canvas");
          pixels.width = 80;
          pixels.height = 100;
          const ctx = pixels.getContext("2d");
          ctx.drawImage(canvas, 0, 0, 80, 100);
          if (
            ctx
              .getImageData(0, 0, 80, 100)
              .data.filter((n, i) => i % 4 === 3 && n > 24).length < 200
          )
            throw new Error(`Blank physical pose ${preset}`);
          const copy = svg.cloneNode(true),
            img = document.createElement("img");
          img.src = canvas.toDataURL();
          img.style.cssText = "width:100%;height:100%;display:block";
          copy.querySelector("canvas").replaceWith(img);
          const cell = document.createElement("div");
          cell.style.cssText = `grid-column:${Object.keys(MOTION_DEMOS).indexOf(preset) + 1};grid-row:${step + 1};min-height:0;display:flex;flex-direction:column;align-items:center`;
          const title = document.createElement("span");
          title.textContent = `${label} · ${step + 1}`;
          title.style.fontSize = "12px";
          cell.append(copy, title);
          host.append(cell);
        }
        svg.remove();
      }
      window.disposeMotionPoses = () => {
        figures.forEach((f) => f.dispose?.());
        host.remove();
      };
    },
    { id: projectId, schemeId },
  );
  try {
    await page.locator("#motion-poses").screenshot({
      path: path.join(directory, `${schemeId}-motion-light.png`),
    });
    await page.locator("#motion-poses").evaluate((element) => {
      element.style.background = "#181b19";
      element.style.color = "#f5eee6";
    });
    await page.locator("#motion-poses").screenshot({
      path: path.join(directory, `${schemeId}-motion-dark.png`),
    });
  } finally {
    await page.evaluate(() => window.disposeMotionPoses());
  }
}
module.exports.inspectMotionPoses = inspectMotionPoses;
