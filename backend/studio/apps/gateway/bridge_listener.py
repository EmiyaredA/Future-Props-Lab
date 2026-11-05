"""Run the Creative bridge on an owner-only Unix socket alongside Caddy."""

import threading
import time
from contextlib import contextmanager

import uvicorn

from .creative_bridge import create_creative_bridge, private_socket, private_text


@contextmanager
def serve_creative_bridge(*, directory, public_key, gateway_credential, ingress_file):
    app = create_creative_bridge(
        public_key=public_key,
        gateway_credential=gateway_credential,
        ingress_secret=private_text(ingress_file),
    )
    listener, path = private_socket(directory)
    server = uvicorn.Server(
        uvicorn.Config(app, access_log=False, proxy_headers=False, timeout_graceful_shutdown=5)
    )
    worker = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    try:
        worker.start()
        deadline = time.monotonic() + 5
        while worker.is_alive() and not server.started and time.monotonic() < deadline:
            worker.join(timeout=0.02)
        if not server.started:
            raise RuntimeError("Creative 中介未能启动")
        yield worker
    finally:
        server.should_exit = True
        if worker.ident is not None:
            worker.join(timeout=7)
        listener.close()
        path.unlink(missing_ok=True)
