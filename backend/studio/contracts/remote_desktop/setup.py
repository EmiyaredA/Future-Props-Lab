"""Fixed operations on the Mac cloud setup channel."""

from .apps import APPS_PATH

SETTINGS_PATH = "/v1/cloud-control/settings"
READ = "remote.settings.read"
SAVE = "remote.settings.save"
APP_LIST = "remote.apps.list"
APP_INSTALLED = "remote.apps.installed"
APP_CONNECT = "remote.apps.connect"
APP_SAVE = "remote.apps.save"
REQUESTS = {
    READ: ("GET", SETTINGS_PATH),
    SAVE: ("PUT", SETTINGS_PATH),
    APP_LIST: ("GET", APPS_PATH),
    APP_INSTALLED: ("GET", APPS_PATH + "/installed"),
    APP_CONNECT: ("POST", APPS_PATH + "/connect"),
    APP_SAVE: ("PUT", APPS_PATH),
}
OPERATIONS = frozenset(REQUESTS)
APP_OPERATIONS = OPERATIONS - {READ, SAVE}
READ_ONLY = OPERATIONS - {SAVE, APP_SAVE}
