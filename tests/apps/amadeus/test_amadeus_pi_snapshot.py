import json
from pathlib import Path


def test_vendored_agent_exports_have_sources():
    package = Path("vendor/pi/packages/agent")
    exports = json.loads((package / "package.json").read_text())["exports"]
    for name, target in exports.items():
        if name == "./package.json":
            continue
        source = target["import"].replace("./dist/", "src/").removesuffix(".js") + ".ts"
        assert (package / source).is_file(), f"export {name} is missing its runtime source"
    assert "./node" not in exports
    assert "./harness/env/nodejs" not in exports
