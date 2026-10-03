// Visual QA runs only inside the smoke's disposable Electron process.
const path = require("node:path");

async function inspectHumanPet(page, projectId, directory, schemeId = null) {
  await page.evaluate(
    async ({ id, schemeId }) => {
      const response = await fetch(`/v1/desktop-pet/projects/${id}/document`);
      if (!response.ok) throw new Error("Human smoke snapshot unavailable");
      const snapshot = await response.json();
      const { createHumanFigure } =
        await import("/src/features/desktop-pet/humanFigure.ts");
      const host = document.createElement("div");
      host.id = "human-rig-inspection";
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:repeat(5,1fr);background:#eee9e1;color:#302c2b;padding:12px;gap:8px";
      document.body.appendChild(host);
      const fixtures = [
        ["待机", "idle", "neutral"],
        ["走路", "walk", "neutral"],
        ["跳跃", "air", "surprised"],
        ["拖起", "drag", "angry"],
        ["坐下", "sit", "neutral"],
        ["睡觉", "sleep", "sleep"],
        ["开心 / 说话", "idle", "happy"],
        ["害羞", "idle", "shy"],
        ["生气", "idle", "angry"],
        ["思考", "idle", "thinking"],
      ];
      const figures = [];
      for (const [label, mode, face] of fixtures) {
        const figure = await createHumanFigure({
          model: snapshot.whaleModel,
          scheme: schemeId ?? snapshot.config.schemeId,
          asset: (name) => snapshot.assetUrls[snapshot.whaleAssets[name]],
        });
        figures.push(figure);
        const cell = document.createElement("div");
        cell.style.cssText =
          "display:flex;flex-direction:column;align-items:center;min-height:0";
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", "0 -8 256 310");
        svg.style.cssText = "width:100%;height:calc(100% - 30px)";
        const group = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        svg.appendChild(group);
        const title = document.createElement("span");
        title.textContent = label;
        cell.append(svg, title);
        host.appendChild(cell);
        for (let index = 1; index <= 90; index++) {
          figure.draw(
            group,
            { blush: face === "shy" ? 0.8 : 0 },
            {
              t: index / 60,
              mode,
              face,
              look: [0, 0],
              legs:
                mode === "walk"
                  ? [
                      [114, 220, 132, 250],
                      [144, 220, 126, 250],
                    ]
                  : [
                      [114, 220, 114, 256],
                      [144, 220, 144, 256],
                    ],
              low: mode === "sit" || mode === "sleep" ? 29 : 0,
              swing: mode === "drag" ? 25 : 0,
              sit: mode === "sit" || mode === "sleep" ? 1 : 0,
              blink: 0,
              eyeClose: 0,
              talk: face === "happy" ? 0.7 : 0,
              tilt: 0,
              lean: 0,
            },
          );
        }
        const canvas = cell.querySelector("canvas");
        const gl = canvas.getContext("webgl2");
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4)
          if (pixels[i] > 128) opaque++;
        if (opaque < 10000) throw new Error(`Human pose blank: ${label}`);
      }
      window.disposeHumanInspection = () => {
        figures.forEach((figure) => figure.dispose());
        host.remove();
      };
    },
    { id: projectId, schemeId },
  );
  try {
    await page
      .locator("#human-rig-inspection")
      .screenshot({ path: path.join(directory, "poses-light.png") });
    await page.locator("#human-rig-inspection").evaluate((host) => {
      host.style.background = "#181b19";
      host.style.color = "#f5eee6";
    });
    await page
      .locator("#human-rig-inspection")
      .screenshot({ path: path.join(directory, "poses-dark.png") });
  } finally {
    await page.evaluate(() => window.disposeHumanInspection());
  }
}

module.exports = { inspectHumanPet };

async function inspectHumanWalk(page, projectId, directory, schemeId = null) {
  await page.evaluate(
    async ({ id, schemeId }) => {
      const snapshot = await (
        await fetch(`/v1/desktop-pet/projects/${id}/document`)
      ).json();
      const { createHumanFigure } =
        await import("/src/features/desktop-pet/humanFigure.ts");
      const { createPet } =
        await import("/src/features/desktop-pet/whale-vendor/pet-core.js");
      const host = document.createElement("div");
      host.id = "human-walk-inspection";
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:repeat(4,1fr);background:#eee9e1;color:#302c2b;padding:12px;gap:8px";
      document.body.appendChild(host);
      const figures = [];
      for (const mode of ["walk", "run"]) {
        for (let step = 0; step < 4; step++) {
          const figure = await createHumanFigure({
            model: snapshot.whaleModel,
            scheme: schemeId ?? snapshot.config.schemeId,
            asset: (name) => snapshot.assetUrls[snapshot.whaleAssets[name]],
          });
          figures.push(figure);
          const cell = document.createElement("div");
          cell.style.cssText =
            "display:flex;flex-direction:column;align-items:center;min-height:0";
          const ns = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(ns, "svg");
          svg.setAttribute("viewBox", "0 0 256 320");
          svg.style.cssText = "width:100%;height:calc(100% - 30px)";
          const group = document.createElementNS(ns, "g"),
            fx = document.createElementNS(ns, "g"),
            shadow = document.createElementNS(ns, "ellipse");
          svg.append(shadow, group, fx);
          const title = document.createElement("span");
          title.textContent = `${mode === "walk" ? "走路" : "跑步"} · 步相 ${step + 1}`;
          cell.append(svg, title);
          host.append(cell);
          const pet = createPet(
            { petG: group, shadowEl: shadow, fxG: fx },
            {
              figure,
              sfx: new Proxy({}, { get: () => () => {} }),
              roam: "off",
              walkInPlace: true,
              startX: 128,
              bounds: () => ({ W: 256, H: 320, floorY: 308, S: 1 }),
            },
          );
          pet.replaceReaction(mode, null, true);
          for (
            let tick = 0;
            tick < 25 + step * (mode === "walk" ? 6 : 4);
            tick++
          ) {
            pet.step(1 / 60);
            pet.render();
          }
        }
      }
      window.disposeWalkInspection = () => {
        figures.forEach((figure) => figure.dispose());
        host.remove();
      };
    },
    { id: projectId, schemeId },
  );
  try {
    await page
      .locator("#human-walk-inspection")
      .screenshot({ path: path.join(directory, "walk-cycle-light.png") });
    await page.locator("#human-walk-inspection").evaluate((host) => {
      host.style.background = "#181b19";
      host.style.color = "#f5eee6";
    });
    await page
      .locator("#human-walk-inspection")
      .screenshot({ path: path.join(directory, "walk-cycle-dark.png") });
  } finally {
    await page.evaluate(() => window.disposeWalkInspection());
  }
}
module.exports.inspectHumanWalk = inspectHumanWalk;
