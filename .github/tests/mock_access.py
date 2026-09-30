#!/usr/bin/env python3
"""Local stand-in for Cloudflare Access + the Worker, used only by .github/tests/run.sh.

Path prefix selects the scenario:
  /good/...          anonymous -> 302 login; service token -> app responses
  /redirect-all/...  every request -> 302 login (service token not accepted)
  /open/...          no Access in front: anonymous requests reach the app
  /bad-aud/...       Access OK, but the Worker rejects the JWT on data routes (401)
Writes the chosen port to argv[1]. Binds 127.0.0.1 only.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LATEST = {"version": "global-20260930", "files": {"skills.json": "/master/global-20260930/skills.json"}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body=None, location=None):
        data = json.dumps(body).encode() if body is not None else b""
        self.send_response(code)
        if location:
            self.send_header("Location", location)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        _, scenario, *rest = self.path.split("/", 2)
        path = "/" + (rest[0] if rest else "")
        authed = (
            self.headers.get("CF-Access-Client-Id") == "synthetic-id.access"
            and self.headers.get("CF-Access-Client-Secret") == "synthetic-secret"
        )
        login = "https://example-team.cloudflareaccess.com/cdn-cgi/access/login"
        if scenario == "redirect-all" or (scenario in ("good", "bad-aud") and not authed):
            return self.send(302, location=login)
        if path == "/api/v1/health":
            return self.send(200, {"ok": True, "masterVersion": "global-20260930", "dbSchemaVersion": 2})
        if path == "/master/latest.json":
            return self.send(200, LATEST)
        if path == "/api/v1/roster":
            if scenario == "bad-aud":
                return self.send(401, {"title": "Unauthorized"})
            return self.send(200, {"veterans": []})
        if path == "/":
            return self.send(200, {"spa": True})
        return self.send(404, {"title": "Not Found"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(sys.argv[1], "w") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
