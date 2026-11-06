"""Build Happier Web or its compatible CLI runner from the reviewed upstream revision."""

import argparse
import subprocess
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
REVISION = "2aeb139d391ba53685d18805d784438fd0e11a5a"
SETTINGS = "apps/ui/sources/sync/domains/settings/registry/local/localSettingDefinitions.ts"


def build(checkout, origin, relay_image, tag, runner_tag):
    output = ROOT / ".local" / "happier-build"
    subprocess.run(["git", "check-ignore", "-q", str(output / "context")], cwd=ROOT, check=True)
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output) as directory:
        context = Path(directory)
        with subprocess.Popen(
            ["git", "-C", str(checkout), "archive", REVISION], stdout=subprocess.PIPE
        ) as archive:
            with tarfile.open(fileobj=archive.stdout, mode="r|") as source:
                source.extractall(context, filter="data")
            if archive.wait() != 0:
                raise RuntimeError("无法读取已核对的 Happier 版本")
        defaults = context / SETTINGS
        source = defaults.read_text()
        before = (
            "sessionsRightPaneDefaultOpen: {\n        schema: z.boolean(),\n        default: false,"
        )
        if source.count(before) != 1:
            raise RuntimeError("Happier 原生侧栏设置已变更，请重新核对")
        defaults.write_text(source.replace(before, before.replace("false", "true")))
        dockerfile = context / "Dockerfile"
        source = dockerfile.read_text().replace(
            "FROM node:", "ARG FPL_HAPPIER_RELAY_BASE=scratch\n\nFROM node:", 1
        )
        dockerfile.write_text(
            source
            + "\nFROM ${FPL_HAPPIER_RELAY_BASE} AS fpl-relay\n"
            + "COPY --from=webapp-builder /repo/apps/ui/dist /opt/fpl-happier/ui-web\n"
            + "ENV HAPPIER_SERVER_UI_DIR=/opt/fpl-happier/ui-web\n"
            + "\nFROM deps-alpine-build AS fpl-cli-builder\n"
            + "COPY . .\n"
            + "RUN cd apps/cli && HAPPIER_CLI_PKGROLL_TIMEOUT_MS=1800000 "
            + "npm pack --pack-destination /tmp\n"
            + "FROM node:24-bookworm AS fpl-runner\n"
            + "COPY --from=fpl-cli-builder /tmp/happier-dev-cli-*.tgz /tmp/happier-cli.tgz\n"
            + "RUN npm install --global /tmp/happier-cli.tgz @openai/codex@0.166.0 "
            + "&& rm /tmp/happier-cli.tgz "
            + "&& install -d -o node -g node /runner /projects/workspace\n"
            + "USER node\nWORKDIR /projects/workspace\n"
        )
        target = (
            ["--target", "fpl-runner", "--tag", runner_tag]
            if runner_tag
            else [
                "--target",
                "fpl-relay",
                "--build-arg",
                f"EXPO_PUBLIC_HAPPIER_SERVER_URL={origin}",
                "--build-arg",
                f"FPL_HAPPIER_RELAY_BASE={relay_image}",
                "--tag",
                tag,
            ]
        )
        subprocess.run(["docker", "build", *target, str(context)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("--origin")
    parser.add_argument("--relay-image")
    parser.add_argument("--tag", default=f"fpl/happier:{REVISION[:8]}")
    parser.add_argument("--runner-tag", help="Build the matching CLI runner instead of the relay")
    args = parser.parse_args()
    if not args.runner_tag and not (args.origin and args.relay_image):
        parser.error("Relay builds require --origin and --relay-image")
    build(args.checkout, args.origin, args.relay_image, args.tag, args.runner_tag)
