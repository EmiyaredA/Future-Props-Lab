from __future__ import annotations

import argparse

from db.migrations import apply_migrations, check_migrations


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        migration_id = check_migrations()
        print(f"schema current: {migration_id}")
        return
    migration_id, changed = apply_migrations()
    action = "applied migration" if changed else "schema already current"
    print(f"{action}: {migration_id}")


if __name__ == "__main__":
    main()
