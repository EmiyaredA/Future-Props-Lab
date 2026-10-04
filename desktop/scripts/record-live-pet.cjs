// Capture the actual isolated pet window while UI gestures and host movement run.
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { installPetRecordingTimeline } = require("./pet-recording-timeline.cjs");
async function startLivePetRecording(page) {
  await page.evaluate(installPetRecordingTimeline);
  await page.evaluate(async () => {
    const started = performance.now();
    let captureId = 0;
    const clock = () => {
      const performanceMs = performance.now();
      return {
        seconds: (performanceMs - started) / 1000,
        performanceMs,
        captureId,
      };
    };
    // Fresh RPC trace points and recordings share this exact page clock.
    window.petRecordingClock = clock;
    const initial = await window.futurePropsDesktop.petEnvironment();
    const cache = window.petRecordingTimelineTools.cache(initial),
      sample = window.petRecordingTimelineTools.sampler(),
      events = [
        { type: "initial-environment", clock: clock(), environment: initial },
      ],
      captures = [];
    // Read host-confirmed updates without awaiting an IPC roundtrip on each
    // render frame. The recorder must not delay the motion it is inspecting.
    const unsubscribe = window.futurePropsDesktop.onPetEnvironment((value) => {
      const timing = clock();
      events.push({
        type: "external-environment",
        clock: timing,
        environment: value,
        ...cache.external(value),
      });
    });
    // Normal movement receipts are a distinct stream. Environment changes
    // pause trajectories and therefore cannot be emitted for every movement.
    const unsubscribeMotion = window.futurePropsDesktop.onPetMotionConfirmed(
      (value) => {
        const timing = clock();
        events.push({
          type: "motion-receipt",
          clock: timing,
          receipt: value,
          ...cache.receipt(value, timing),
        });
      },
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(initial.workArea.width);
    canvas.height = Math.ceil(initial.workArea.height);
    const ctx = canvas.getContext("2d"),
      // Capture above the acceptance floor; verify actual encoded timestamps,
      // rather than filling dropped source frames with repeated images.
      stream = canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm",
      videoBitsPerSecond: 6000000,
    });
    const chunks = [],
      snapshots = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    let request = 0,
      alive = true;
    let pointer = null;
    const pointerTypes = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ];
    const recordPointer = (event) => {
      pointer = {
        type: event.type,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        buttons: event.buttons,
        pointerId: event.pointerId,
        ...clock(),
      };
      events.push({ type: "pointer", pointer });
    };
    for (const type of pointerTypes)
      document.addEventListener(type, recordPointer, { capture: true });
    recorder.start();
    events.push({ type: "recorder-start", clock: clock() });
    const tick = (now) => {
      if (!alive) return;
      const { environment: env, confirmation } = cache.read();
      const object = document.querySelector(".pet-runtime foreignObject");
      const source = object?.querySelector("canvas"),
        matrix = object?.getScreenCTM();
      const seconds = Math.max(0, (now - started) / 1000);
      captureId++;
      const timing = clock();
      const current =
        document.querySelector(".pet-runtime")?.getAttribute("data-motion") ??
        "idle";
      const edge =
        document
          .querySelector(".pet-runtime")
          ?.getAttribute("data-motion-edge") ?? "";
      const stage =
        document
          .querySelector(".pet-runtime")
          ?.getAttribute("data-motion-stage") ?? "";
      const attachment =
        document
          .querySelector(".pet-runtime")
          ?.getAttribute("data-motion-attachment") ?? "";
      const signature = `${current}:${edge}:${stage}:${attachment}`;
      if (canvas.width !== Math.ceil(env.workArea.width))
        canvas.width = Math.ceil(env.workArea.width);
      if (canvas.height !== Math.ceil(env.workArea.height))
        canvas.height = Math.ceil(env.workArea.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ece7df";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#937960";
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      if (source && matrix) {
        ctx.setTransform(
          matrix.a,
          matrix.b,
          matrix.c,
          matrix.d,
          matrix.e + env.bounds.x - env.workArea.x,
          matrix.f + env.bounds.y - env.workArea.y,
        );
        ctx.drawImage(
          source,
          object.x.baseVal.value,
          object.y.baseVal.value,
          object.width.baseVal.value,
          object.height.baseVal.value,
        );
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#3b322b";
      ctx.font = "16px sans-serif";
      ctx.fillText(
        `#${captureId} · ${seconds.toFixed(3)} s · ${signature} · 宿主确认 ${env.bounds.x}, ${env.bounds.y}`,
        12,
        canvas.height - 12,
      );
      const frame = {
        captureId,
        seconds,
        recordingClock: timing,
        rafPerformanceMs: now,
        afterDrawClock: clock(),
        sourcePresent: Boolean(source && matrix),
        screenMatrix: matrix
          ? {
              a: matrix.a,
              b: matrix.b,
              c: matrix.c,
              d: matrix.d,
              e: matrix.e,
              f: matrix.f,
            }
          : null,
        sourceRect: object
          ? {
              x: object.x.baseVal.value,
              y: object.y.baseVal.value,
              width: object.width.baseVal.value,
              height: object.height.baseVal.value,
            }
          : null,
        mode: current,
        edge,
        stage,
        attachment,
        sceneOffset: env.sceneOffset,
        bounds: env.bounds,
        environment: env,
        confirmation,
        pointer,
        grip: document
          .querySelector(".pet-runtime")
          ?.getAttribute("data-motion-grip"),
      };
      // Every actual draw is retained as metadata even if the encoder drops a
      // frame. Decode visible capture IDs to map source PTS, never infer them.
      captures.push(frame);
      if (sample(seconds, signature, current !== "idle", stage)) {
        // PNG encoding runs asynchronously after the canvas snapshot. Retain
        // source order and timestamps; never duplicate frames to fill gaps.
        snapshots.push(
          new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error("Live frame PNG encoding failed"));
                return;
              }
              const reader = new FileReader();
              reader.onerror = () => reject(reader.error);
              reader.onload = () =>
                resolve({ ...frame, png: reader.result.split(",")[1] });
              reader.readAsDataURL(blob);
            }, "image/png");
          }),
        );
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    window.finishLivePetRecording = async () => {
      alive = false;
      cancelAnimationFrame(request);
      unsubscribe();
      unsubscribeMotion();
      for (const type of pointerTypes)
        document.removeEventListener(type, recordPointer, { capture: true });
      events.push({ type: "recorder-stop-request", clock: clock() });
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const video = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
      });
      delete window.petRecordingClock;
      return {
        video,
        frames: await Promise.all(snapshots),
        captures,
        events,
        clockOrigin: {
          performanceMs: started,
          timeOrigin: performance.timeOrigin,
        },
      };
    };
  });
}
async function finishLivePetRecording(page, directory) {
  const result = await page.evaluate(() => window.finishLivePetRecording());
  const output = path.join(directory, "live-recording");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    path.join(output, "pet-interactions.webm"),
    Buffer.from(result.video, "base64"),
  );
  result.frames.forEach((frame, i) =>
    writeFileSync(
      path.join(output, `${String(i).padStart(5, "0")}-${frame.mode}.png`),
      Buffer.from(frame.png, "base64"),
    ),
  );
  writeFileSync(
    path.join(output, "frames.json"),
    JSON.stringify(
      result.frames.map(({ png, ...frame }) => frame),
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(output, "captures.json"),
    JSON.stringify(result.captures, null, 2),
  );
  writeFileSync(
    path.join(output, "events.json"),
    JSON.stringify(result.events, null, 2),
  );
  writeFileSync(
    path.join(output, "clock-origin.json"),
    JSON.stringify(result.clockOrigin, null, 2),
  );
}
module.exports = { startLivePetRecording, finishLivePetRecording };
