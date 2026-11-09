"""Prepare, switch or roll back one independent frontend without restarting it."""

import argparse
from pathlib import Path

from studio.host.deployment.web_release import WEB_APPS, activate, compose_override, seed, stage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    commands = parser.add_subparsers(dest="operation", required=True)
    for name in ("seed", "stage", "activate"):
        command = commands.add_parser(name)
        command.add_argument("service", choices=sorted(WEB_APPS))
        if name == "activate":
            command.add_argument("build_id")
            command.add_argument("--expect", required=True)
            command.add_argument("--api-sha256", required=True)
        else:
            command.add_argument("source", type=Path)
    compose = commands.add_parser("compose-override")
    compose.add_argument("apps", choices=sorted(WEB_APPS), nargs="+")
    args = parser.parse_args()
    if args.operation == "compose-override":
        print(compose_override(args.root, args.apps), end="")
        return
    directory = args.root.resolve() / args.service
    if args.operation == "activate":
        release = activate(
            directory,
            args.service,
            args.build_id,
            expected=args.expect,
            api_sha256=args.api_sha256,
        )
    else:
        install = seed if args.operation == "seed" else stage
        release = install(args.source, directory, args.service)
    print(f"{release.service} {release.build_id}")


if __name__ == "__main__":
    main()
