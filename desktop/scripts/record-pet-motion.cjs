// Normal-speed footage from the production GPU renderer in isolated Electron only.
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { installPetRecordingTimeline } = require("./pet-recording-timeline.cjs");
async function recordPetMotion(page, projectId, directory, schemeId) {
  const output = path.join(directory, "recordings");
  mkdirSync(output, { recursive: true });
  await page.evaluate(installPetRecordingTimeline);
  const result = await page.evaluate(
    async ({ projectId, schemeId }) => {
      const snapshot = await (
        await fetch(`/v1/desktop-pet/projects/${projectId}/document`)
      ).json();
      const { createHumanFigure } =
        await import("/src/features/desktop-pet/humanFigure.ts");
      const { createWhaleFigure } =
        await import("/src/features/desktop-pet/whale-vendor/whale/figure.js");
      const { createPet } =
        await import("/src/features/desktop-pet/whale-vendor/pet-core.js");
      const { demoMotion, MOTION_DEMOS } =
        await import("/src/features/desktop-pet/locomotion/demo.ts");
      const options = {
        model: snapshot.whaleModel,
        scheme: schemeId,
        asset: (name) => snapshot.assetUrls[snapshot.whaleAssets[name]],
      };
      const human = snapshot.whaleModel.rigProfile === "human-chibi";
      const figure = human
        ? await createHumanFigure(options)
        : await createWhaleFigure(null, options);
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg"),
        group = document.createElementNS(ns, "g"),
        shadow = document.createElementNS(ns, "ellipse"),
        fx = document.createElementNS(ns, "g");
      svg.append(shadow, group, fx);
      svg.style.cssText =
        "position:fixed;left:-2000px;width:600px;height:600px";
      document.body.append(svg);
      const pet = createPet(
        { petG: group, shadowEl: shadow, fxG: fx },
        {
          figure,
          walkInPlace: true,
          roam: "off",
          startX: 300,
          bounds: () => ({ W: 600, H: 600, floorY: 340, S: 1 }),
          sfx: new Proxy({}, { get: () => () => {} }),
        },
      );
      const movie = document.createElement("canvas");
      movie.width = 600;
      movie.height = 600;
      const ctx = movie.getContext("2d"),
        stream = movie.captureStream(60);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 4000000,
        }),
        chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const done = new Promise((resolve) => (recorder.onstop = resolve)),
        frames = [],
        captures = [],
        events = [],
        recordingStarted = performance.now();
      let captureId = 0;
      const clock = () => {
        const performanceMs = performance.now();
        return {
          seconds: (performanceMs - recordingStarted) / 1000,
          performanceMs,
          captureId,
        };
      };
      recorder.start();
      events.push({ type: "recorder-start", clock: clock() });
      try {
        pet.render();
        for (const [preset, label] of Object.entries(MOTION_DEMOS)) {
          const started = performance.now();
          let last = started,
            recoveryStarted = null,
            guide = null;
          const sample = window.petRecordingTimelineTools.sampler();
          events.push({ type: "preset-start", preset, clock: clock() });
          await new Promise((resolve) => {
            const tick = (now) => {
              const seconds = Math.max(0, (now - started) / 1000);
              captureId++;
              const timing = clock();
              const active = seconds < 1.6;
              if (!active && recoveryStarted === null) {
                recoveryStarted = seconds;
                events.push({ type: "active-end", preset, clock: clock() });
              }
              const poseName =
                preset.startsWith("walk") || preset === "land"
                  ? "walk"
                  : preset === "held"
                    ? "held"
                    : preset.startsWith("glide")
                      ? "glide"
                      : preset === "climb-top"
                        ? "top"
                        : preset === "climb-bottom"
                          ? "bottom"
                          : "side";
              const motion = demoMotion(
                preset,
                Math.min(1.6, seconds),
                snapshot.whaleModel.motionRig?.poses?.[poseName]?.stride,
              );
              pet.setLocomotion(active ? motion : null);
              pet.step(Math.min(0.05, (now - last) / 1000));
              last = now;
              pet.render();
              const canvas = group.querySelector("canvas"),
                object = canvas.closest("foreignObject");
              const matrix = group.transform.baseVal.consolidate().matrix;
              const travel = motion.travel ?? { x: 0, y: 0 };
              if (!guide && active) {
                const edge = preset.startsWith("climb")
                  ? motion.edge
                  : "bottom";
                const plane = snapshot.whaleModel.motionRig?.poses?.[poseName]
                  ?.edges?.[edge] ?? [128, 256];
                const point = new DOMPoint(...plane).matrixTransform(matrix);
                guide = { edge, x: point.x + travel.x, y: point.y + travel.y };
              }
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.fillStyle = "#eee9e1";
              ctx.fillRect(0, 0, 600, 600);
              ctx.fillStyle = "#d9cfc4";
              if (
                guide &&
                (preset.startsWith("walk") ||
                  preset === "land" ||
                  preset.startsWith("climb"))
              ) {
                ctx.fillStyle = "#c5b9ad";
                if (guide.edge === "left" || guide.edge === "right")
                  ctx.fillRect(guide.x, 40, 2, 480);
                else ctx.fillRect(0, guide.y, 600, 2);
              }
              ctx.setTransform(
                matrix.a,
                matrix.b,
                matrix.c,
                matrix.d,
                matrix.e + travel.x,
                matrix.f + travel.y,
              );
              ctx.drawImage(
                canvas,
                object.x.baseVal.value,
                object.y.baseVal.value,
                object.width.baseVal.value,
                object.height.baseVal.value,
              );
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.fillStyle = "#463a34";
              ctx.font = "18px sans-serif";
              ctx.fillText(
                `${schemeId} · ${label} · ${active ? motion.stage : "结束 / 恢复待机"}`,
                14,
                27,
              );
              ctx.font = "14px monospace";
              ctx.fillText(
                `#${captureId} / ${timing.seconds.toFixed(3)} s / ${seconds.toFixed(3)} s 姿态 / 正常速度`,
                14,
                578,
              );
              const frame = {
                captureId,
                preset,
                seconds,
                recordingClock: timing,
                rafPerformanceMs: now,
                afterDrawClock: clock(),
                active,
                motion,
                matrix: {
                  a: matrix.a,
                  b: matrix.b,
                  c: matrix.c,
                  d: matrix.d,
                  e: matrix.e,
                  f: matrix.f,
                },
                travel,
                guide,
              };
              captures.push(frame);
              if (
                sample(
                  seconds,
                  `${preset}:${active}:${motion.stage}`,
                  active,
                  motion.stage,
                )
              ) {
                frames.push({
                  ...frame,
                  png: movie.toDataURL("image/png").split(",")[1],
                });
              }
              // The longest supported stop lasts 600 ms after the 1.6 s loop.
              // Keep another 300 ms of stable recovery before the next preset.
              if (recoveryStarted === null || seconds - recoveryStarted < 0.9)
                requestAnimationFrame(tick);
              else {
                events.push({ type: "preset-end", preset, clock: clock() });
                resolve();
              }
            };
            requestAnimationFrame(tick);
          });
        }
      } finally {
        events.push({ type: "recorder-stop-request", clock: clock() });
        recorder.stop();
        await done;
        stream.getTracks().forEach((track) => track.stop());
        figure.dispose?.();
        svg.remove();
      }
      const buffer = await new Blob(chunks, { type: mime }).arrayBuffer();
      const video = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.readAsDataURL(new Blob([buffer], { type: mime }));
      });
      return {
        video,
        frames,
        captures,
        events,
        mime,
        clockOrigin: {
          performanceMs: recordingStarted,
          timeOrigin: performance.timeOrigin,
        },
      };
    },
    { projectId, schemeId },
  );
  writeFileSync(
    path.join(output, `${schemeId}.webm`),
    Buffer.from(result.video, "base64"),
  );
  for (const [index, frame] of result.frames.entries())
    writeFileSync(
      path.join(
        output,
        `${schemeId}-${frame.preset}-${String(index).padStart(3, "0")}.png`,
      ),
      Buffer.from(frame.png, "base64"),
    );
  writeFileSync(
    path.join(output, `${schemeId}-frames.json`),
    JSON.stringify(
      result.frames.map(({ png, ...frame }) => frame),
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(output, `${schemeId}-captures.json`),
    JSON.stringify(result.captures, null, 2),
  );
  writeFileSync(
    path.join(output, `${schemeId}-events.json`),
    JSON.stringify(result.events, null, 2),
  );
  writeFileSync(
    path.join(output, `${schemeId}-clock-origin.json`),
    JSON.stringify(result.clockOrigin, null, 2),
  );
}
module.exports = { recordPetMotion };
