"""Discover CMS releases and atomically index the relevant PDP public-use files.

CMS archives contain multi-GB pharmacy networks. HTTP range reads fetch just the
compact nested archives needed for plans, geography, formularies and cost sharing.
No fabricated data, credentials, beneficiary identifiers, or cross-year fallback.
"""
import csv
from contextlib import closing
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

from .calendar import enrollment_context

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("CORSAIR_DATA_DIR", str(ROOT / "data")))
CATALOG = "https://data.cms.gov/data.json"
CMS_PAGE = "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/monthly-prescription-drug-plan-formulary-and-pharmacy-network-information"
TITLE = "Monthly Prescription Drug Plan Formulary and Pharmacy Network Information"
SYNC_SECONDS = 6 * 60 * 60
STATE = {"running": False, "phase": "Waiting for first automatic update", "error": None, "checked_at": None}
LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def request(url, headers=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "MedicareCorsair/0.2 (public-data-comparison)", **(headers or {})}), timeout=90)


def json_get(url):
    with request(url) as response:
        return json.load(response)


class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
            self.size = int(response.headers["Content-Length"])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else (self.pos if whence == 1 else self.size) + offset
        return self.pos

    def read(self, n=-1):
        n = self.size - self.pos if n < 0 else min(n, self.size - self.pos)
        if n <= 0: return b""
        start = self.pos
        with request(self.url, {"Range": f"bytes={start}-{start + n - 1}"}) as response:
            if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-"):
                raise ValueError("CMS did not honor the partial-download request; large download prevented.")
            result = response.read(n)
        if len(result) != n:
            raise ValueError("Incomplete CMS download; previous snapshot preserved.")
        self.pos += len(result)
        return result


def discover(catalog, year):
    candidates = []
    for item in catalog.get("dataset", []):
        if not item.get("title", "").startswith(TITLE): continue
        for dist in item.get("distribution", []):
            url = dist.get("downloadURL", "")
            # The release title's year is NOT necessarily the coverage year.
            if re.search(rf"/{year}_\d{{8}}\.zip$", url, re.I) and url.startswith("https://data.cms.gov/"):
                candidates.append({"title": item["title"], "url": url, "modified": dist.get("modified", item.get("modified")), "year": year})
    if not candidates:
        raise ValueError(f"CMS has not published an available {year} monthly archive in its catalog. No other year's plans will be substituted.")
    return max(candidates, key=lambda x: re.search(r"(\d{8})\.zip$", x["url"]).group(1))


def connect(year):
    db = sqlite3.connect(DATA / f"plans-{year}.sqlite", timeout=30)
    db.row_factory = sqlite3.Row
    return db


def metadata(year):
    path = DATA / f"plans-{year}.sqlite"
    if not path.exists(): return None
    with closing(connect(year)) as db:
        return json.loads(db.execute("SELECT value FROM metadata WHERE key='source'").fetchone()[0])


def records(archive, prefix):
    members = [f for f in archive.infolist() if f.filename.lower().startswith(prefix)]
    if len(members) != 1: raise ValueError(f"CMS schema changed: expected one {prefix} archive.")
    # Never extract archive-supplied paths onto the filesystem.
    with zipfile.ZipFile(io.BytesIO(archive.read(members[0]))) as inner:
        names = [n for n in inner.namelist() if n.lower().endswith(".txt")]
        if len(names) != 1: raise ValueError(f"Unexpected file layout in {prefix}.")
        with inner.open(names[0]) as stream:
            reader = csv.DictReader(io.TextIOWrapper(stream, encoding="cp1252", newline=""), delimiter="|")
            for row in reader:
                yield {k.strip().upper(): (v or "").strip() for k, v in row.items() if k}


def build_snapshot(source, destination):
    with zipfile.ZipFile(RemoteZip(source["url"])) as archive, closing(sqlite3.connect(destination)) as db:
        db.executescript('''
        PRAGMA journal_mode=DELETE;
        CREATE TABLE plans (id TEXT PRIMARY KEY, contract TEXT, plan TEXT, segment TEXT, name TEXT, provider TEXT, formulary TEXT, premium REAL, deductible REAL, region TEXT, suppressed TEXT);
        CREATE TABLE regions (state TEXT PRIMARY KEY, region TEXT);
        CREATE TABLE drugs (formulary TEXT, rxcui TEXT, ndc TEXT, tier INTEGER, pa TEXT, st TEXT, ql TEXT, ql_amount TEXT, ql_days TEXT);
        CREATE TABLE costs (plan_key TEXT, tier INTEGER, days INTEGER, level INTEGER, data TEXT);
        CREATE TABLE indications (plan_key TEXT, rxcui TEXT, disease TEXT);
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
        ''')
        STATE["phase"] = "Indexing plan premiums and deductibles"
        formularies, plan_ids = set(), set()
        for row in records(archive, "plan information"):
            if not row["CONTRACT_ID"].startswith("S"): continue
            pid = "-".join([row["CONTRACT_ID"], row["PLAN_ID"], row["SEGMENT_ID"]])
            db.execute("INSERT OR IGNORE INTO plans VALUES (?,?,?,?,?,?,?,?,?,?,?)", (pid, row["CONTRACT_ID"], row["PLAN_ID"], row["SEGMENT_ID"], row["PLAN_NAME"], row["CONTRACT_NAME"], row["FORMULARY_ID"], float(row["PREMIUM"]), float(row["DEDUCTIBLE"]), row["PDP_REGION_CODE"].lstrip("0"), row["PLAN_SUPPRESSED_YN"]))
            formularies.add(row["FORMULARY_ID"]); plan_ids.add(pid)
        for row in records(archive, "geographic locator"):
            if row["PDP_REGION_CODE"]:
                db.execute("INSERT OR IGNORE INTO regions VALUES (?,?)", (row["STATENAME"], row["PDP_REGION_CODE"].lstrip("0")))
        STATE["phase"] = "Matching medications, tiers, and coverage restrictions"
        batch, years = [], set()
        for row in records(archive, "basic drugs formulary"):
            years.add(int(row["CONTRACT_YEAR"]))
            if int(row["CONTRACT_YEAR"]) != source["year"]: raise ValueError("Benefit-year mismatch in CMS formulary; import rejected.")
            if row["FORMULARY_ID"] not in formularies: continue
            batch.append((row["FORMULARY_ID"], row["RXCUI"], row["NDC"], int(row["TIER_LEVEL_VALUE"]), row["PRIOR_AUTHORIZATION_YN"], row["STEP_THERAPY_YN"], row["QUANTITY_LIMIT_YN"], row["QUANTITY_LIMIT_AMOUNT"], row["QUANTITY_LIMIT_DAYS"]))
            if len(batch) >= 10000:
                db.executemany("INSERT INTO drugs VALUES (?,?,?,?,?,?,?,?,?)", batch); batch.clear()
        db.executemany("INSERT INTO drugs VALUES (?,?,?,?,?,?,?,?,?)", batch)
        if years != {source["year"]}: raise ValueError("Empty or inconsistent formulary year.")
        STATE["phase"] = "Indexing retail and mail-order cost sharing"
        for row in records(archive, "beneficiary cost file"):
            pid = "-".join([row["CONTRACT_ID"], row["PLAN_ID"], row["SEGMENT_ID"]])
            if pid in plan_ids:
                db.execute("INSERT INTO costs VALUES (?,?,?,?,?)", (pid, int(row["TIER"]), int(row["DAYS_SUPPLY"]), int(row["COVERAGE_LEVEL"]), json.dumps(row)))
        for row in records(archive, "indication based coverage"):
            pid = row["CONTRACT_ID"] + "-" + row["PLAN_ID"] + "-000"
            if pid in plan_ids: db.execute("INSERT INTO indications VALUES (?,?,?)", (pid, row["RXCUI"], row["DISEASE"]))
        db.executescript("CREATE INDEX drug_lookup ON drugs(formulary,rxcui); CREATE INDEX cost_lookup ON costs(plan_key,tier,days,level); CREATE INDEX indication_lookup ON indications(plan_key,rxcui);")
        source = {**source, "imported_at": now(), "plan_count": len(plan_ids), "formulary_rows": db.execute("SELECT COUNT(*) FROM drugs").fetchone()[0], "scope": "Stand-alone Part D plans (PDP); Medicare Advantage excluded", "page": CMS_PAGE}
        if not source["plan_count"] or not source["formulary_rows"]: raise ValueError("Incomplete CMS import; previous snapshot preserved.")
        db.execute("INSERT INTO metadata VALUES ('source',?)", (json.dumps(source),))
        db.commit()
    return source


def sync():
    if not LOCK.acquire(blocking=False): return
    temp = None
    STATE.update(running=True, error=None, phase="Checking CMS for the latest enrollment-year release")
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        year = enrollment_context()["year"]
        source = discover(json_get(CATALOG), year)
        previous = metadata(year)
        if not previous or previous["url"] != source["url"] or previous.get("modified") != source["modified"]:
            temp = DATA / f"plans-{year}.next.sqlite"
            temp.unlink(missing_ok=True)
            build_snapshot(source, temp)
            os.replace(temp, DATA / f"plans-{year}.sqlite")
        STATE.update(phase="Up to date", checked_at=now())
        (DATA / "sync-status.json").write_text(json.dumps({"checked_at": STATE["checked_at"]}), encoding="utf-8")
    except Exception as error:
        STATE.update(error=str(error), phase="Update failed · last successful snapshot retained")
    finally:
        if temp: temp.unlink(missing_ok=True)
        STATE["running"] = False
        LOCK.release()


def start_scheduler():
    try: STATE.update(json.loads((DATA / "sync-status.json").read_text(encoding="utf-8")))
    except (OSError, ValueError): pass
    def loop():
        while True:
            sync()
            time.sleep(15 * 60 if STATE["error"] else SYNC_SECONDS)
    threading.Thread(target=loop, daemon=True, name="cms-auto-refresh").start()


def status():
    context = enrollment_context()
    return {"enrollment": context, "sync": dict(STATE), "source": metadata(context["year"]), "interval_hours": SYNC_SECONDS // 3600, "pricing": {"available": False, "reason": "The imported monthly CMS release has cost-sharing rules, but no drug-specific negotiated prices or pharmacy network lookup. Exact annual totals need a Medicare Plan Finder estimate.", "url": "https://www.medicare.gov/plan-compare/"}}
