"""Compile an exact HTTP template without matching across path segments."""

import re


def path_pattern(path):
    return re.compile("^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(path)) + "$")
