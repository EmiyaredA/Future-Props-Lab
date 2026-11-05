"""Run the installed Thought release through the isolated gateway."""

import io
import json
import subprocess
import zipfile

from PIL import Image

ROOT = "/v1/thought-workshop"


def verify_thought(client, unsafe, compose, repo, origin, *, browser=False):
    compose(
        "exec",
        "-T",
        "thought",
        "python",
        "-c",
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ready', timeout=2)",
    )
    entry = client.get("/apps/thought-workshop")
    assert entry.status_code == 200, entry.text[:300]
    build_id = entry.headers["x-application-build"]
    assert f"/_apps/thought/{build_id}/" in entry.text
    assert client.get(f"/_apps/thought/{build_id}/build.json").json()["service"] == "thought"
    assert client.get("/apps/thought-workshop/community").status_code == 200
    stale = client.post(
        ROOT + "/knowledge-bases",
        headers={**unsafe, "X-Application-Id": "thought", "X-Application-Build": "stale"},
        json={"title": "Stale"},
    )
    assert stale.status_code == 409, stale.text
    library = client.post(
        ROOT + "/knowledge-bases", headers=unsafe, json={"title": "Thought fixture"}
    )
    assert library.status_code == 200, library.text
    library = library.json()
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "navy").save(image, format="PNG")
    uploaded = client.post(
        ROOT + "/images",
        headers=unsafe,
        files={"upload": ("fixture.png", image.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    asset = uploaded.json()["asset_id"]
    note = client.post(
        ROOT + "/notes",
        headers=unsafe,
        json={
            "title": "Fixture note",
            "knowledge_base_id": library["id"],
            "expected_knowledge_revision": library["revision"],
            "document": {
                "type": "doc",
                "content": [{"type": "image", "attrs": {"assetId": asset}}],
            },
        },
    )
    assert note.status_code == 200, note.text
    assert client.get(f"/v1/files/{asset}/content").content == image.getvalue()
    archive = client.get(ROOT + "/backup", params={"knowledge_base_id": library["id"]})
    assert archive.status_code == 200, archive.text[:300]
    with zipfile.ZipFile(io.BytesIO(archive.content)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert len(manifest["assets"]) == 1
        assert package.read(manifest["assets"][0]["path"]) == image.getvalue()
    imports = [
        client.post(
            ROOT + "/imports",
            headers={**unsafe, "Idempotency-Key": "isolated-archive"},
            files={"upload": ("fixture.zip", archive.content, "application/zip")},
        )
        for _ in range(2)
    ]
    assert all(result.status_code == 200 for result in imports), [result.text for result in imports]
    assert imports[0].json() == imports[1].json()
    preview = client.get(ROOT + "/community/official-import/preview")
    assert preview.status_code == 200 and preview.json()["article_count"] > 0, preview.text
    if browser:
        subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                """
import { chromium } from "playwright";
const data = await new Promise((resolve) => {
  let input = "";
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => resolve(JSON.parse(input)));
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FPL_TEST_CHROMIUM || undefined,
});
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 840 } });
  await context.addCookies(Object.entries(data.cookies).map(([name, value]) => ({
    name, value, url: data.origin,
  })));
  const page = await context.newPage();
  const response = await page.goto(data.origin + "/apps/thought-workshop", {
    waitUntil: "domcontentloaded",
  });
  if (response.status() !== 200) throw new Error("Thought page did not load");
  await page.getByRole("heading", { name: "Thought fixture", exact: true }).first().waitFor();
  const note = await page.goto(
    data.origin + "/apps/thought-workshop/knowledge-bases/" + data.project +
      "/documents/" + data.note,
    { waitUntil: "domcontentloaded" },
  );
  if (note.status() !== 200) throw new Error("Thought deep link did not load");
  await page.getByRole("textbox", { name: "笔记正文", exact: true }).waitFor();
  if (!(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))) throw new Error("Thought exceeds the responsive viewport");
} finally { await browser.close(); }
""",
            ],
            cwd=repo,
            text=True,
            input=json.dumps(
                {
                    "origin": origin,
                    "cookies": dict(client.cookies),
                    "project": library["id"],
                    "note": note.json()["id"],
                }
            ),
            check=True,
            timeout=45,
        )
    return "Thought readiness, versioned browser entry, asset round trip and archive replay"
