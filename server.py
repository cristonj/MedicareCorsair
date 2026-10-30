"""Run: python server.py. Python 3.11+; install requirements for PDF import."""
import argparse
import io
import zipfile
from collections import OrderedDict
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.error import URLError

from backend import data
from backend.calendar import enrollment_context
from backend.compare import compare
from backend.importer import import_quotes

ROOT = Path(__file__).resolve().parent
CACHE = OrderedDict()
CACHE_LOCK = threading.Lock()
DRUG_LOCK = threading.Lock()
LAST_RX = 0.0


def drugs(query):
    global LAST_RX
    if not 2 <= len(query) <= 100: raise ValueError("Enter at least two letters of a medication name.")
    with CACHE_LOCK:
        cached = CACHE.get(query.casefold())
        if cached and time.monotonic() - cached[0] < 86400: return cached[1]
    # Serialize requests well below RxNav's published request limit.
    with DRUG_LOCK:
        time.sleep(max(0, .1 - (time.monotonic() - LAST_RX)))
        result = data.json_get("https://rxnav.nlm.nih.gov/REST/drugs.json?" + urlencode({"name": query}))
        LAST_RX = time.monotonic()
    found = []
    for group in result.get("drugGroup", {}).get("conceptGroup", []):
        if group.get("tty") not in ("SCD", "SBD"): continue
        for item in group.get("conceptProperties", []):
            found.append({"rxcui": item["rxcui"], "name": item["name"], "brand": group["tty"] == "SBD"})
    found.sort(key=lambda d: (not d["name"].casefold().startswith(query.casefold()), d["brand"], d["name"]))
    payload = {"results": found[:150], "source": "https://rxnav.nlm.nih.gov/", "message": "Select the exact strength and form on your prescription label."}
    with CACHE_LOCK:
        CACHE[query.casefold()] = (time.monotonic(), payload)
        if len(CACHE) > 300: CACHE.popitem(last=False)
    return payload


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # Medication names and profile requests are never written to access logs.
        pass

    def end_headers(self):
        if self.headers.get('Origin') == 'https://medicarecorsair.netlify.app':
            self.send_header('Access-Control-Allow-Origin', 'https://medicarecorsair.netlify.app')
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        super().end_headers()

    def send_json(self, value, status=200):
        body = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def allowed_host(self):
        # Protect the loopback service from DNS rebinding.
        host = self.headers.get("Host", "")
        return host in {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"}

    def do_OPTIONS(self):
        if not self.allowed_host() or self.headers.get('Origin') != 'https://medicarecorsair.netlify.app': return self.send_json({'error':'Cross-origin request rejected'},403)
        if not self.path.startswith('/api/'): return self.send_error(404)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()

    def do_GET(self):
        if not self.allowed_host(): return self.send_json({"error": "Unrecognized host"}, 403)
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/status": return self.send_json(data.status())
            if parsed.path == '/extension.zip':
                buffer=io.BytesIO()
                with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
                    for path in (ROOT/'extension').iterdir():
                        if path.is_file() and path.suffix in {'.js','.json','.css','.html'}:archive.write(path,path.name)
                payload=buffer.getvalue();self.send_response(200);self.send_header('Content-Type','application/zip');self.send_header('Content-Disposition','attachment; filename="MedicareCorsair-extension.zip"');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
            if parsed.path == "/api/drugs": return self.send_json(drugs(parse_qs(parsed.query).get("q", [""])[0].strip()))
            if parsed.path == "/api/states":
                year = enrollment_context()["year"]
                if not data.metadata(year): return self.send_json({"states": []})
                with closing(data.connect(year)) as db: states = [r[0] for r in db.execute("SELECT state FROM regions ORDER BY state")]
                return self.send_json({"states": states})
            # Explicit static allowlist: no datasets, source, or directory listings.
            if parsed.path not in {"/", "/index.html", "/styles.css", "/app.js", "/favicon.svg", "/privacy.html", "/setup-guides.json"}: return self.send_error(404)
            return super().do_GET()
        except ValueError as error: return self.send_json({"error": str(error)}, 400)
        except (URLError, TimeoutError, OSError): return self.send_json({"error": "The data provider is unavailable. Please try again shortly; your entries are still here."}, 502)

    def do_POST(self):
        if not self.allowed_host(): return self.send_json({"error": "Unrecognized host"}, 403)
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://localhost:{self.server.server_port}", f"http://127.0.0.1:{self.server.server_port}", 'https://medicarecorsair.netlify.app'}: return self.send_json({"error": "Cross-origin request rejected"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json": return self.send_json({"error": "Use application/json"}, 415)
        try:
            length = int(self.headers.get("Content-Length", 0))
            maximum = 28 * 1024 * 1024 if self.path == '/api/import-quotes' else 64000
            if not 0 < length <= maximum: return self.send_json({"error": "Request is too large or empty"}, 413)
            body = json.loads(self.rfile.read(length))
            if self.path == '/api/import-quotes': return self.send_json(import_quotes(body))
            if self.path == "/api/compare": return self.send_json(compare(body))
            if self.path == "/api/sync":
                threading.Thread(target=data.sync, daemon=True).start()
                return self.send_json({"started": True}, 202)
            return self.send_error(404)
        except (ValueError, TypeError, OverflowError) as error: return self.send_json({"error": str(error)}, 400)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--sync-only", action="store_true")
    args = parser.parse_args()
    if args.sync_only:
        data.sync()
        print(json.dumps(data.status(), indent=2))
        raise SystemExit(1 if data.STATE["error"] else 0)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    data.start_scheduler()
    print(f"MedicareCorsair: http://127.0.0.1:{args.port}", flush=True)
    print("CMS auto-refresh: startup + every 6 hours. Stop with Ctrl+C.", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
