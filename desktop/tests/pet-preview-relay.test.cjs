const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PetPreviewRelay } = require("../dist/pet-preview-relay.js");
const { previewDraft } = require("../dist/pet-preview-protocol.js");
function owner(id = 1) {
  const value = new EventEmitter();
  value.id = id;
  value.isDestroyed = () => false;
  value.messages = [];
  value.send = (channel, data) => value.messages.push([channel, data]);
  return value;
}
const identity = { projectId: "pet", sessionId: "session", baseRevision: 2 };
function draft(patch = {}) {
  return {
    ...identity,
    sequence: 1,
    skinId: null,
    eventName: "click",
    mode: "inspect",
    key: 1,
    line: 0,
    config: {
      schemaVersion: 2,
      activeSkinId: null,
      schemeId: null,
      skins: [],
      events: {
        click: {
          motionId: "hop",
          expressionId: "happy",
          lines: ["草稿"],
          sound: "none",
        },
      },
      habits: {
        size: 220,
        roam: "off",
        sound: false,
        bubbles: true,
        draggable: true,
        hoverActions: [],
      },
    },
    ...patch,
  };
}
test("relay rejects competing owners, project/session mismatch, stale revisions and reordered updates", () => {
  const deliveries = [];
  const relay = new PetPreviewRelay((value) => deliveries.push(value));
  const editor = owner();
  relay.begin(editor, identity);
  assert.throws(() => relay.begin(owner(2), identity), /占用/);
  relay.update(editor, draft());
  assert.throws(() => relay.update(editor, draft()), /过期/);
  assert.throws(
    () => relay.update(editor, draft({ sequence: 2, baseRevision: 1 })),
    /过期/,
  );
  assert.throws(() => relay.update(owner(2), draft({ sequence: 2 })), /失效/);
  assert.throws(
    () => relay.update(editor, draft({ sequence: 2, projectId: "other" })),
    /失效/,
  );
  assert.throws(
    () => relay.update(editor, draft({ sequence: 2, sessionId: "other" })),
    /失效/,
  );
  relay.update(editor, draft({ sequence: 2, baseRevision: 3 }));
  assert.equal(deliveries.at(-1).draft.baseRevision, 3);
  relay.endByOwner(2);
  assert.ok(relay.current());
  relay.endByOwner(1, "wrong-session");
  assert.ok(relay.current());
  relay.endByOwner(1, "session");
  assert.equal(deliveries.at(-1), null);
});
test("chat pauses delivery, retains latest draft, and resumes it without a competing lease", () => {
  const deliveries = [];
  const relay = new PetPreviewRelay((value) => deliveries.push(value));
  const editor = owner();
  relay.pause(true);
  assert.equal(relay.begin(editor, identity).state, "paused");
  relay.update(editor, draft());
  relay.update(editor, draft({ sequence: 2, key: 4 }));
  assert.equal(deliveries.at(-1).paused, true);
  relay.pause(false);
  assert.equal(deliveries.at(-1).draft.key, 4);
  assert.equal(deliveries.at(-1).paused, false);
  relay.end();
});
for (const event of [
  "destroyed",
  "render-process-gone",
  "did-start-navigation",
]) {
  test(`owner ${event} releases draft and lifecycle listeners`, () => {
    const relay = new PetPreviewRelay(() => {});
    const editor = owner();
    relay.begin(editor, identity);
    relay.update(editor, draft());
    editor.emit(event);
    assert.equal(relay.current(), null);
    assert.equal(editor.listenerCount("destroyed"), 0);
  });
}
test("expiry restores baseline and stale renderer error reports cannot cancel a newer update", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const relay = new PetPreviewRelay(() => {});
  const editor = owner();
  relay.begin(editor, identity);
  relay.update(editor, draft());
  t.mock.timers.tick(6000);
  relay.update(editor, draft({ sequence: 2 }));
  relay.report({
    sessionId: "session",
    sequence: 1,
    state: "error",
    message: "旧错误",
  });
  assert.ok(relay.current());
  t.mock.timers.tick(6000);
  assert.ok(relay.current());
  t.mock.timers.tick(501);
  assert.equal(relay.current(), null);
});
test("transport carries only bounded display data and asset IDs", () => {
  assert.equal(previewDraft(draft()).sequence, 1);
  const current = draft();
  const motionHabits = {
    ...current.config.habits,
    edgeClimbing: true,
    highGliding: false,
  };
  assert.equal(
    previewDraft({
      ...current,
      config: { ...current.config, habits: motionHabits },
    }).config.habits.edgeClimbing,
    true,
  );
  assert.throws(
    () =>
      previewDraft({
        ...current,
        config: {
          ...current.config,
          habits: { ...motionHabits, highGliding: "yes" },
        },
      }),
    /习惯/,
  );
  assert.throws(() => previewDraft(draft({ character: {} })), /未允许/);
  assert.throws(
    () => previewDraft(draft({ config: { ...draft().config, persona: {} } })),
    /未允许/,
  );
  assert.throws(
    () =>
      previewDraft(
        draft({
          config: {
            ...draft().config,
            skins: [
              {
                id: "s",
                name: "皮肤",
                replacements: { asset: "https://evil/texture" },
              },
            ],
          },
        }),
      ),
    /标识/,
  );
  assert.throws(() => previewDraft(draft({ line: 8 })), /状态/);
  assert.throws(
    () =>
      previewDraft(
        draft({
          config: {
            ...draft().config,
            habits: { ...draft().config.habits, size: 99999 },
          },
        }),
      ),
    /习惯/,
  );
});
