"""Relay a frozen Tools navigation dataset over authenticated loopback HTTP."""

from fpl_tools.migration_application import PREFIX
from fpl_tools.navigation_migration import DATASET, NavigationPage

from .migration_transfer import DatasetTransfer, run_cli

NAVIGATION = DatasetTransfer(DATASET, PREFIX, NavigationPage, "tool_id")

if __name__ == "__main__":
    run_cli(__doc__, (NAVIGATION,))
