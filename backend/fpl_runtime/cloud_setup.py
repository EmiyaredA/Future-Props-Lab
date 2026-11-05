"""Fixed operations on the Mac cloud setup channel."""

SETTINGS_PATH = "/v1/cloud-control/settings"
READ = "remote.settings.read"
SAVE = "remote.settings.save"
OPERATIONS = frozenset({READ, SAVE})
