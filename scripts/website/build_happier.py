"""Build the dedicated Happier relay/Web bundle from the reviewed upstream revision."""

import argparse
import subprocess
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
REVISION = "2aeb139d391ba53685d18805d784438fd0e11a5a"
SETTINGS = "apps/ui/sources/sync/domains/settings/registry/local/localSettingDefinitions.ts"


def build(checkout, origin, relay_image, tag):
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
            "FROM node:", "ARG FPL_HAPPIER_RELAY_BASE\n\nFROM node:", 1
        )
        dockerfile.write_text(
            source
            + "\nFROM ${FPL_HAPPIER_RELAY_BASE} AS fpl-relay\n"
            + "COPY --from=webapp-builder /repo/apps/ui/dist /opt/fpl-happier/ui-web\n"
            + "ENV HAPPIER_SERVER_UI_DIR=/opt/fpl-happier/ui-web\n"
        )
        subprocess.run(
            [
                "docker",
                "build",
                "--target",
                "fpl-relay",
                "--build-arg",
                f"EXPO_PUBLIC_HAPPIER_SERVER_URL={origin}",
                "--build-arg",
                f"FPL_HAPPIER_RELAY_BASE={relay_image}",
                "--tag",
                tag,
                str(context),
            ],
            check=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--relay-image", required=True)
    parser.add_argument("--tag", default=f"fpl/happier:{REVISION[:8]}")
    args = parser.parse_args()
    build(args.checkout, args.origin, args.relay_image, args.tag)
