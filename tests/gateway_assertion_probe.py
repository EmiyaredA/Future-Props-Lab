"""Disposable protocol test upstream; never included in a production image."""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from cryptography.hazmat.primitives.serialization import load_pem_public_key

from fpl_runtime.claims import HEADER, verify_context


class Probe(BaseHTTPRequestHandler):
    def do_GET(self):
        key = load_pem_public_key(Path(os.environ["FPL_PROBE_KEY"]).read_bytes())
        try:
            actor = verify_context(
                self.headers.get(HEADER, ""),
                service="agents",
                method="GET",
                path=self.path.split("?")[0],
                public_key=key,
            )
        except Exception:
            self.send_response(401)
            self.end_headers()
            return
        body = json.dumps(
            {
                "owner": actor.user_id,
                "local": actor.local,
                "gateway_token_leaked": bool(self.headers.get("X-Fpl-Gateway")),
                "ingress_header_leaked": bool(self.headers.get("X-Fpl-Ingress")),
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Probe).serve_forever()
