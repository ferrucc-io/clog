#!/usr/bin/env python3
"""Send a test log entry to the clog server."""

import json
import urllib.request
from pathlib import Path


def main():
    server_json_path = Path.home() / ".clog" / "server.json"
    if not server_json_path.exists():
        print(f"ERROR: {server_json_path} not found — is the clog server running?")
        raise SystemExit(1)

    with open(server_json_path) as f:
        server_info = json.load(f)

    port = server_info["port"]
    url = f"http://localhost:{port}/log"

    payload = json.dumps({"service": "hello-world", "msg": "Hello from Python!"}).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req) as resp:
        status = resp.status
        body = resp.read().decode("utf-8")

    print(f"Status: {status}")
    print(f"Body:   {body}")


if __name__ == "__main__":
    main()
