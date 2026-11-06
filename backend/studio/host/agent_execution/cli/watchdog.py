"""Terminate a native executor when its application parent exits."""

import os
import signal
import subprocess


def supervise(parent_pid, command):
    process = subprocess.Popen(command, start_new_session=True)

    def stop(_signal=None, _frame=None):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while process.poll() is None:
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                stop()
                break
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        return process.wait()
    finally:
        stop()
