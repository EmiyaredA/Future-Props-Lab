const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const handlers = new Map();
const windows = [];
class MockWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = options;
    this.visible = false;
    this.webContents = new EventEmitter();
    this.webContents.id = 100 + windows.length;
    this.webContents.isDestroyed = () => this.isDestroyed();
    this.webContents.mainFrame = { url: "" };
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.send = (channel, value) =>
      this.webContents.emit(channel, value);
    windows.push(this);
  }
  async loadURL(url) {
    this.webContents.mainFrame.url = url;
    this.webContents.emit("did-finish-load");
  }
  setBounds(value) {
    this.bounds = value;
  }
  getBounds() {
    return this.bounds;
  }
  isDestroyed() {
    return Boolean(this.destroyed);
  }
  isVisible() {
    return this.visible;
  }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents(value, options) {
    this.ignored = value;
    this.forward = options.forward;
  }
  show() {
    this.visible = true;
  }
  showInactive() {
    this.show();
  }
  focus() {}
  hide() {
    this.visible = false;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}
const area = { x: 0, y: 25, width: 1280, height: 775 };
const displayEvents = new Map();
let displays = [{ id: 1, workArea: area }];
const electron = {
  BrowserWindow: MockWindow,
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  screen: {
    on: (event, callback) => displayEvents.set(event, callback),
    getAllDisplays: () => displays,
    getDisplayMatching: () => displays[0],
    getDisplayNearestPoint: (point) =>
      displays.find(
        (d) =>
          point.x >= d.workArea.x && point.x < d.workArea.x + d.workArea.width,
      ) ?? displays[0],
    getCursorScreenPoint: () => ({ x: 1000, y: 700 }),
  },
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "electron"
    ? electron
    : originalLoad.call(this, name, ...args);
};
const { PetWindowController } = require("../dist/pet-window.js");
Module._load = originalLoad;
const sender = (win) => ({
  sender: win.webContents,
  senderFrame: win.webContents.mainFrame,
});

test("companion IPC is private, bounded, transparent and keeps its window when changing layout", async () => {
  const controller = new PetWindowController({
    preload: "fixture",
    pageOrigin: () => "http://fixture",
    trusted: (url) => url.startsWith("http://fixture/"),
    isStudioSender: (event) => event.sender.id === 1,
    showStudio() {},
    canOpen: () => true,
  });
  controller.installIpc();
  const studio = {
    sender: { id: 1 },
    senderFrame: { url: "http://fixture/home" },
  };
  handlers.get("desktop:pet-context")(studio, {
    userId: "u",
    workspaceId: "w",
  });
  await handlers.get("desktop:pet-open")(
    studio,
    "11111111-1111-1111-1111-111111111111",
  );
  const pet = windows[0];
  await handlers.get("desktop:pet-chat-open")(sender(pet));
  const chat = windows[1];
  assert.equal(chat.options.transparent, true);
  assert.equal(chat.options.hasShadow, false);
  assert.equal(chat.options.webPreferences.nodeIntegration, false);
  assert.throws(() =>
    handlers.get("desktop:pet-chat-layout")(studio, "expanded"),
  );
  assert.throws(() =>
    handlers.get("desktop:pet-chat-layout")(sender(chat), { width: 99999 }),
  );
  assert.throws(() => handlers.get("desktop:pet-chat-hit")(sender(pet), true));
  assert.throws(() =>
    handlers.get("desktop:pet-chat-hit")(sender(chat), "yes"),
  );
  handlers.get("desktop:pet-chat-layout")(sender(chat), "expanded");
  assert.equal(chat.bounds.width, 360);
  handlers.get("desktop:pet-chat-layout")(sender(chat), "compact");
  assert.equal(chat.bounds.width, 320);
  assert.equal(windows.length, 2);
  handlers.get("desktop:pet-chat-hit")(sender(chat), false);
  assert.equal(chat.ignored, true);
  assert.equal(chat.forward, true);
  handlers.get("desktop:pet-chat-hit")(sender(chat), true);
  assert.equal(chat.ignored, false);
  const projectId = "11111111-1111-1111-1111-111111111111";
  const mainFrame = {
    url: `http://fixture/apps/desktop-pet/projects/${projectId}/editor`,
  };
  const editor = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
  let refreshes = 0;
  pet.webContents.on("desktop:pet-resources-changed", () => refreshes++);
  const notify = handlers.get("desktop:pet-resources-changed");
  assert.throws(() => notify(studio, projectId), /编辑器/);
  assert.throws(() => notify(sender(pet), projectId), /编辑器/);
  assert.throws(
    () => notify({ ...editor, senderFrame: { ...mainFrame } }, projectId),
    /编辑器/,
  );
  notify(editor, projectId);
  assert.equal(refreshes, 1);
  assert.equal(windows.length, 2);
  assert.equal(chat.isDestroyed(), false);
  handlers.get("desktop:pet-context")(studio, {
    userId: "u",
    workspaceId: "other",
  });
  assert.equal(chat.isDestroyed(), true);
  assert.equal(pet.isDestroyed(), true);
});

test("preview IPC enforces trusted main frame, account, Workspace, project and a single editor owner", async () => {
  const projectId = "11111111-1111-1111-1111-111111111111";
  const controller = new PetWindowController({
    preload: "fixture",
    pageOrigin: () => "http://fixture",
    trusted: (url) => url.startsWith("http://fixture/"),
    isStudioSender: (event) => [1, 2, 3].includes(event.sender.id),
    showStudio() {},
    canOpen: () => true,
  });
  controller.installIpc();
  const editor = (
    id,
    url = "http://fixture/apps/desktop-pet/projects/" + projectId + "/editor",
  ) => {
    const contents = new EventEmitter();
    contents.id = id;
    contents.isDestroyed = () => false;
    contents.send = () => {};
    contents.mainFrame = { url };
    return { sender: contents, senderFrame: contents.mainFrame };
  };
  const first = editor(1),
    second = editor(2),
    foreign = editor(3);
  handlers.get("desktop:pet-context")(first, { userId: "u", workspaceId: "w" });
  handlers.get("desktop:pet-context")(second, {
    userId: "u",
    workspaceId: "w",
  });
  handlers.get("desktop:pet-context")(foreign, {
    userId: "other",
    workspaceId: "other",
  });
  await handlers.get("desktop:pet-open")(first, projectId);
  const pet = windows.at(-1);
  const identity = { projectId, baseRevision: 0, sessionId: "test-session" };
  const begin = handlers.get("desktop:pet-preview-begin");
  assert.throws(() => begin(foreign, identity), /同一空间/);
  assert.throws(
    () =>
      begin(
        { ...first, senderFrame: { url: first.senderFrame.url } },
        identity,
      ),
    /同一空间/,
  );
  assert.throws(
    () =>
      begin(
        editor(
          1,
          "http://evil/apps/desktop-pet/projects/" + projectId + "/editor",
        ),
        identity,
      ),
    /同一空间/,
  );
  assert.throws(
    () => begin(first, { ...identity, projectId: "other-project" }),
    /同一空间/,
  );
  assert.throws(
    () => handlers.get("desktop:pet-preview-current")(first),
    /非桌宠/,
  );
  begin(first, identity);
  assert.throws(
    () => begin(second, { ...identity, sessionId: "second" }),
    /占用/,
  );
  const config = {
    schemaVersion: 2,
    skins: [],
    activeSkinId: null,
    schemeId: null,
    events: {},
    habits: {
      size: 220,
      roam: "off",
      draggable: true,
      bubbles: true,
      sound: false,
      hoverActions: [],
    },
  };
  const draft = {
    ...identity,
    sequence: 1,
    config,
    skinId: null,
    eventName: "idle",
    mode: "inspect",
    key: 1,
    line: 0,
  };
  handlers.get("desktop:pet-preview-update")(first, draft);
  assert.equal(
    handlers.get("desktop:pet-preview-current")(sender(pet)).paused,
    false,
  );
  await handlers.get("desktop:pet-chat-open")(sender(pet));
  assert.equal(
    handlers.get("desktop:pet-preview-current")(sender(pet)).paused,
    true,
  );
  handlers.get("desktop:pet-chat-close")(sender(windows.at(-1)));
  assert.equal(
    handlers.get("desktop:pet-preview-current")(sender(pet)).paused,
    false,
  );
  first.sender.emit("render-process-gone");
  assert.equal(handlers.get("desktop:pet-preview-current")(sender(pet)), null);
  begin(second, { ...identity, sessionId: "second" });
  handlers.get("desktop:pet-preview-update")(second, {
    ...draft,
    sessionId: "second",
  });
  controller.detachStudio(2);
  assert.equal(handlers.get("desktop:pet-preview-current")(sender(pet)), null);
  begin(first, identity);
  handlers.get("desktop:pet-context")(first, null);
  assert.equal(pet.isDestroyed(), true);
});

test("motion IPC rejects stale, foreign and paused updates and follows display changes", async () => {
  const projectId = "11111111-1111-1111-1111-111111111111";
  const controller = new PetWindowController({
    preload: "fixture",
    pageOrigin: () => "http://fixture",
    trusted: (url) => url.startsWith("http://fixture/"),
    isStudioSender: (event) => event.sender.id === 1,
    showStudio() {},
    canOpen: () => true,
  });
  controller.installIpc();
  const studio = {
    sender: { id: 1 },
    senderFrame: { url: "http://fixture/home" },
  };
  handlers.get("desktop:pet-context")(studio, {
    userId: "u",
    workspaceId: "w",
  });
  await handlers.get("desktop:pet-open")(studio, projectId);
  const pet = windows.at(-1),
    trusted = sender(pet);
  const read = () => handlers.get("desktop:pet-environment")(trusted);
  const move = (value) => handlers.get("desktop:pet-motion")(trusted, value);
  const geometry = {
    visible: { x: 80, y: 130, width: 140, height: 220 },
    feet: { x: 150, y: 350 },
  };
  const request = (overrides = {}) => ({
    generation: read().generation,
    sequence: 1,
    environmentRevision: read().revision,
    x: -1000,
    y: 1000,
    geometry,
    manual: false,
    ...overrides,
  });
  assert.throws(
    () => handlers.get("desktop:pet-environment")(studio),
    /非桌宠/,
  );
  assert.throws(
    () =>
      handlers.get("desktop:pet-motion")(
        { ...trusted, senderFrame: { ...trusted.senderFrame } },
        request(),
      ),
    /不可用/,
  );
  const placed = move(request());
  assert.equal(placed.bounds.x + geometry.visible.x, 4);
  assert.equal(placed.bounds.y + geometry.feet.y, 796);
  assert.throws(() => move(request()), /过期/);
  const old = request({ sequence: 2 });
  handlers.get("desktop:pet-motion-cancel")(trusted, 2);
  assert.throws(() => move(old), /过期/);
  displays = [
    { id: 2, workArea: { x: -1280, y: -300, width: 1280, height: 800 } },
    { id: 1, workArea: area },
  ];
  const moved = move(request({ manual: true, x: -900, y: -100 }));
  assert.equal(moved.displayId, 2);
  const automatic = move(request({ sequence: 2, x: 9000 }));
  assert.equal(automatic.displayId, 2);
  assert.ok(automatic.bounds.x < 0);
  const outdated = request({ sequence: 3 });
  displays = [{ id: 1, workArea: area }];
  displayEvents.get("display-removed")();
  assert.equal(read().displayId, 1);
  assert.throws(() => move(outdated), /边界已变化/);
  await handlers.get("desktop:pet-chat-open")(trusted);
  assert.throws(() => move(request()), /暂停自主运动/);
  handlers.get("desktop:pet-chat-close")(sender(windows.at(-1)));
  const updates = [];
  pet.webContents.on("desktop:pet-environment", (value) => updates.push(value));
  handlers.get("desktop:pet-hide")(trusted);
  assert.equal(read().visible, false);
  assert.throws(() => move(request()), /不可用/);
  await handlers.get("desktop:pet-open")(studio, projectId);
  assert.equal(updates.at(-1).visible, true);
  controller.close();
  assert.throws(read, /非桌宠/);
});

test("continuous motion confirmation is pet-only, reports actual host bounds and never cancels motion", async () => {
  const controller = new PetWindowController({
    preload: "fixture",
    pageOrigin: () => "http://fixture",
    trusted: (url) => url.startsWith("http://fixture/"),
    isStudioSender: (event) => event.sender.id === 1,
    showStudio() {},
    canOpen: () => true,
  });
  controller.installIpc();
  const studioContents = new EventEmitter();
  studioContents.id = 1;
  const studio = {
    sender: studioContents,
    senderFrame: { url: "http://fixture/home" },
  };
  handlers.get("desktop:pet-context")(studio, {
    userId: "u",
    workspaceId: "w",
  });
  await handlers.get("desktop:pet-open")(
    studio,
    "11111111-1111-1111-1111-111111111111",
  );
  const pet = windows.at(-1),
    trusted = sender(pet);
  await handlers.get("desktop:pet-chat-open")(trusted);
  const chat = windows.at(-1);
  // Simulate a native window constraint after setBounds: the menu bar limits
  // the shell even though the transparent canvas may extend above that shell.
  pet.setBounds = (bounds) => {
    pet.bounds = { ...bounds, y: Math.max(25, bounds.y) };
  };
  const read = () => handlers.get("desktop:pet-environment")(trusted);
  const move = (event, value) =>
    handlers.get("desktop:pet-motion")(event, value);
  const alignmentOrder = [];
  chat.webContents.on("desktop:pet-chat-layout", () =>
    alignmentOrder.push("chat"),
  );
  const confirmations = [],
    environmentEvents = [],
    foreignReceipts = [];
  pet.webContents.on("desktop:pet-motion-confirmed", (value) => {
    confirmations.push(value);
    alignmentOrder.push("confirmed");
  });
  pet.webContents.on("desktop:pet-environment", (value) =>
    environmentEvents.push(value),
  );
  chat.webContents.on("desktop:pet-motion-confirmed", (value) =>
    foreignReceipts.push(value),
  );
  studioContents.on("desktop:pet-motion-confirmed", (value) =>
    foreignReceipts.push(value),
  );
  const generation = read().generation;
  const request = {
    generation,
    sequence: 1,
    environmentRevision: read().revision,
    x: 400,
    y: -70,
    manual: true,
    geometry: {
      visible: { x: 80, y: 130, width: 140, height: 220 },
      feet: { x: 150, y: 350 },
    },
  };
  const placed = move(trusted, request);
  assert.equal(placed.bounds.y, 25);
  assert.deepEqual(placed.bounds, pet.getBounds());
  assert.deepEqual(placed.sceneOffset, { x: 0, y: -95 });
  assert.equal(placed.generation, generation);
  assert.deepEqual(confirmations, [{ sequence: 1, environment: placed }]);
  assert.equal(environmentEvents.length, 0);
  assert.equal(foreignReceipts.length, 0);
  assert.deepEqual(alignmentOrder, ["chat", "confirmed"]);
  const second = move(trusted, { ...request, sequence: 2, x: 440 });
  assert.deepEqual(confirmations.at(-1), { sequence: 2, environment: second });
  assert.equal(second.generation, generation);
  assert.equal(environmentEvents.length, 0);
  assert.throws(() => move(trusted, request), /过期/);
  assert.throws(() => move(studio, { ...request, sequence: 3 }), /不可用/);
  assert.throws(
    () => move(sender(chat), { ...request, sequence: 3 }),
    /不可用/,
  );
  assert.throws(
    () =>
      move(
        { ...trusted, senderFrame: { ...trusted.senderFrame } },
        { ...request, sequence: 3 },
      ),
    /不可用/,
  );
  const url = pet.webContents.mainFrame.url;
  pet.webContents.mainFrame.url = "http://evil/pet.html";
  assert.throws(() => move(trusted, { ...request, sequence: 3 }), /不可用/);
  pet.webContents.mainFrame.url = url;
  assert.equal(confirmations.length, 2);
  const nativePlacement = pet.setBounds;
  pet.setBounds = (bounds) => {
    pet.bounds = { ...bounds, x: 2000 };
  };
  assert.throws(
    () => move(trusted, { ...request, sequence: 3 }),
    /无法将完整角色/,
  );
  assert.equal(confirmations.length, 2);
  pet.setBounds = nativePlacement;
  // Cancellation uses its existing channel; its old generation cannot emit a receipt.
  handlers.get("desktop:pet-motion-cancel")(trusted, generation + 1);
  assert.throws(() => move(trusted, { ...request, sequence: 3 }), /过期/);
  assert.equal(confirmations.length, 2);
  handlers.get("desktop:pet-hide")(trusted);
  assert.throws(
    () =>
      move(trusted, { ...request, generation: read().generation, sequence: 3 }),
    /不可用/,
  );
  assert.equal(confirmations.length, 2);
  controller.close();
  assert.throws(() => move(trusted, request), /不可用/);
  assert.equal(confirmations.length, 2);
  assert.equal(foreignReceipts.length, 0);
});

test("a window closed during host placement emits no motion confirmation", async () => {
  const controller = new PetWindowController({
    preload: "fixture",
    pageOrigin: () => "http://fixture",
    trusted: () => true,
    isStudioSender: (event) => event.sender.id === 1,
    showStudio() {},
    canOpen: () => true,
  });
  controller.installIpc();
  const studio = {
    sender: { id: 1 },
    senderFrame: { url: "http://fixture/home" },
  };
  handlers.get("desktop:pet-context")(studio, {
    userId: "u",
    workspaceId: "w",
  });
  await handlers.get("desktop:pet-open")(
    studio,
    "11111111-1111-1111-1111-111111111111",
  );
  const pet = windows.at(-1),
    trusted = sender(pet),
    receipts = [];
  const environment = handlers.get("desktop:pet-environment")(trusted);
  pet.webContents.on("desktop:pet-motion-confirmed", (value) =>
    receipts.push(value),
  );
  pet.setBounds = (bounds) => {
    pet.bounds = bounds;
    controller.close();
  };
  assert.throws(
    () =>
      handlers.get("desktop:pet-motion")(trusted, {
        generation: environment.generation,
        sequence: 1,
        environmentRevision: environment.revision,
        x: 500,
        y: 400,
        manual: true,
        geometry: {
          visible: { x: 80, y: 130, width: 140, height: 220 },
          feet: { x: 150, y: 350 },
        },
      }),
    /不可用/,
  );
  assert.equal(receipts.length, 0);
});

test("preload motion confirmation subscription is read-only, independent and removable", () => {
  const renderer = new EventEmitter();
  let bridge;
  const previousLoad = Module._load;
  Module._load = function (name, ...args) {
    return name === "electron"
      ? {
          ipcRenderer: renderer,
          contextBridge: {
            exposeInMainWorld: (_name, value) => {
              bridge = value;
            },
          },
        }
      : previousLoad.call(this, name, ...args);
  };
  try {
    const preload = require.resolve("../dist/preload.js");
    delete require.cache[preload];
    require(preload);
  } finally {
    Module._load = previousLoad;
  }
  assert.equal(Object.isFrozen(bridge), true);
  const receipts = [],
    environments = [];
  const stopReceipt = bridge.onPetMotionConfirmed((value) =>
    receipts.push(value),
  );
  const stopEnvironment = bridge.onPetEnvironment((value) =>
    environments.push(value),
  );
  const receipt = {
    sequence: 7,
    environment: { generation: 3, bounds: { x: 10, y: 20 } },
  };
  renderer.emit("desktop:pet-motion-confirmed", {}, receipt);
  assert.deepEqual(receipts, [receipt]);
  assert.equal(environments.length, 0);
  stopReceipt();
  assert.equal(renderer.listenerCount("desktop:pet-motion-confirmed"), 0);
  assert.equal(renderer.listenerCount("desktop:pet-environment"), 1);
  renderer.emit("desktop:pet-motion-confirmed", {}, receipt);
  renderer.emit("desktop:pet-environment", {}, receipt.environment);
  assert.equal(receipts.length, 1);
  assert.deepEqual(environments, [receipt.environment]);
  stopEnvironment();
});
