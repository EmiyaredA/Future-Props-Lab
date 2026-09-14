const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isServiceUrl, externalUrl } = require("../dist/security.js");

test("credentials only target the current loopback service, including WebSockets", () => {
  const origin = "http://127.0.0.1:49123";
  for (const url of [
    origin + "/v1/auth/me",
    "ws://127.0.0.1:49123/v1/realtime",
  ])
    assert.equal(isServiceUrl(url, origin), true);
  for (const url of [
    "http://127.0.0.1:49124/",
    "https://evil.invalid",
    "http://127.0.0.1.evil.invalid:49123/",
    "http://user@127.0.0.1:49123/",
    "file:///tmp/test",
    "not a URL",
  ])
    assert.equal(isServiceUrl(url, origin), false);
});

test("external opening rejects local files, executable schemes and embedded credentials", () => {
  assert.equal(externalUrl("https://example.com/help"), true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "shell:appsFolder",
    "https://user:secret@example.com",
    "not a URL",
  ])
    assert.equal(externalUrl(url), false);
});
