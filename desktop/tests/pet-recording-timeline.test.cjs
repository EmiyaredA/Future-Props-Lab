const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  installPetRecordingTimeline,
} = require("../scripts/pet-recording-timeline.cjs");
const {
  selectSourceFrames,
  sourceFilter,
  sourceBatches,
} = require("../scripts/extract-pet-source-frames.cjs");

const env = (revision = 3, generation = 7, x = 50) => ({
  revision,
  generation,
  bounds: { x, y: 20, width: 300, height: 400 },
  sceneOffset: { x: 0, y: 0 },
  displayId: 1,
  workArea: { x: 0, y: 33, width: 1000, height: 700 },
  visible: true,
});

test("receipt cache clears external ownership and rejects stale revisions, generations and sequences", () => {
  const { cache } = installPetRecordingTimeline(),
    state = cache(env());
  assert.equal(
    state.receipt({ sequence: 4, environment: env(3, 7, 60) }, { seconds: 1 })
      .accepted,
    true,
  );
  assert.equal(state.read().confirmation.sequence, 4);
  assert.equal(state.external(env(4, 7, 80)).accepted, true);
  assert.equal(state.read().confirmation, null);
  assert.equal(
    state.receipt({ sequence: 5, environment: env(3, 7, 61) }, {}).reason,
    "stale-environment",
  );
  assert.equal(
    state.receipt({ sequence: 4, environment: env(4, 7, 62) }, {}).reason,
    "stale-sequence",
  );
  assert.equal(
    state.receipt({ sequence: 6, environment: env(4, 6, 63) }, {}).reason,
    "stale-environment",
  );
  assert.equal(state.external(env(3, 8, 64)).accepted, false);
  assert.deepEqual(state.read().environment, env(4, 7, 80));
  assert.equal(
    state.receipt({ sequence: 1, environment: env(4, 8, 90) }, { seconds: 2 })
      .accepted,
    true,
  );
  assert.equal(state.read().confirmation.generation, 8);
});

test("equal generation/revision external bounds and visibility changes clear confirmation without reopening old sequence", () => {
  const state = installPetRecordingTimeline().cache(env());
  state.receipt({ sequence: 10, environment: env() }, { seconds: 1 });
  state.external({ ...env(), visible: false, sceneOffset: { x: 12, y: -10 } });
  assert.equal(state.read().confirmation, null);
  assert.equal(state.read().environment.visible, false);
  assert.equal(
    state.receipt({ sequence: 9, environment: env() }, {}).accepted,
    false,
  );
  assert.equal(
    state.receipt({ sequence: 10, environment: env() }, {}).accepted,
    false,
  );
});

test("fixed loop deadlines retain ten real samples per second at 45/54/60Hz without deadline drift", () => {
  for (const fps of [45, 54, 60]) {
    const sample = installPetRecordingTimeline().sampler(),
      selected = [];
    for (let i = 0; i < fps * 11; i++) {
      const seconds = i / fps;
      if (sample(seconds, "walk:loop", true, "loop")) selected.push(i);
    }
    const steady = selected.filter((i) => i / fps >= 1 && i / fps < 11);
    assert.equal(steady.length, 100, `ten seconds at ${fps}Hz`);
    assert.equal(new Set(selected).size, selected.length);
  }
});

test("transition and actual recovery tail preserve every available rAF; dropped frames are not filled", () => {
  const sample = installPetRecordingTimeline().sampler();
  for (let i = 0; i < 15; i++)
    assert.equal(sample(i / 60, "held:start", true, "start"), true);
  assert.equal(sample(1, "walk:loop", true, "loop"), true);
  // The actual stop starts at 1.62, not at the nominal 1.6 activity duration.
  for (let i = 0; i <= 54; i++)
    assert.equal(sample(1.62 + i / 60, "idle", false, ""), true);
  assert.equal(sample(2.54, "idle", false, ""), false);
  const sparse = installPetRecordingTimeline().sampler();
  assert.equal(sparse(0, "walk:loop", true, "loop"), true);
  assert.equal(sparse(1, "walk:loop", true, "loop"), true);
  assert.equal(sparse(1.01, "walk:loop", true, "loop"), false);
});

test("browser installation is self-contained and shares the exact tested rules", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(`(${installPetRecordingTimeline.toString()})()`, context);
  const state = context.window.petRecordingTimelineTools.cache(env());
  state.receipt({ sequence: 2, environment: env() }, { seconds: 1 });
  state.external(env(3, 7, 99));
  assert.equal(state.read().confirmation, null);
});

test("original-source extraction preserves indices and chooses real cadence without duplicates or FPS filling", () => {
  const pts = Array.from({ length: 61 }, (_, i) => i / 60);
  assert.deepEqual(
    selectSourceFrames(pts, { start: 0.05, end: 0.1 }),
    [3, 4, 5, 6],
  );
  const indices = selectSourceFrames(pts, { cadenceMs: 100 });
  assert.equal(indices.length, 11);
  assert.equal(new Set(indices).size, indices.length);
  assert.ok(
    indices.every((i, n) => !n || pts[i] - pts[indices[n - 1]] <= 0.100000001),
  );
  assert.equal(
    sourceFilter([0, 1, 2, 5]),
    "select=between(n\\,0\\,2)+eq(n\\,5)",
  );
  assert.throws(
    () => selectSourceFrames([0, 0.2], { cadenceMs: 100 }),
    /cannot fill/,
  );
  assert.throws(() => selectSourceFrames([0, 0]), /strictly increasing/);
  assert.throws(() => selectSourceFrames([0, NaN]), /finite/);
  assert.throws(() => selectSourceFrames(pts, { cadenceMs: 0 }), /Invalid/);
});

test("long sparse source selection bounds parser terms and retains exact original/output index ownership", () => {
  const indices = Array.from({ length: 274 }, (_, i) => i * 6),
    batches = sourceBatches(indices);
  assert.equal(batches.length, 6);
  assert.deepEqual(
    batches.flatMap((batch) => batch.indices),
    indices,
  );
  let count = 0;
  for (const batch of batches) {
    assert.equal(batch.firstOutput, count + 1);
    assert.ok(batch.filter.split("+").length <= 48);
    assert.equal(batch.filter.includes("fps"), false);
    count += batch.indices.length;
  }
  // Whole transitions compress into a single absolute-index range.
  const all = Array.from({ length: 15000 }, (_, i) => i);
  assert.equal(sourceBatches(all).length, 1);
  assert.equal(sourceBatches(all)[0].filter, "select=between(n\\,0\\,14999)");
  assert.throws(() => sourceBatches([1, 1]), /strictly increasing/);
  assert.throws(() => sourceBatches([1, 0]), /strictly increasing/);
  assert.throws(() => sourceBatches(indices, 100), /batch limit/);
});
