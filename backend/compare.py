"""Compare sourced facts. Missing prices are never converted to zero."""
import json
from contextlib import closing
import re
from urllib.parse import urlencode
from . import data
from .calendar import enrollment_context


def validate_profile(profile):
    if not isinstance(profile, dict): raise ValueError("Please supply a comparison profile.")
    state = profile.get("state", "")
    meds = profile.get("medications", [])
    if not isinstance(state, str) or not state or len(state) > 50: raise ValueError("Choose your state or territory.")
    if not isinstance(meds, list) or len(meds) > 30: raise ValueError("Add up to 30 medications.")
    validated = []
    for med in meds:
        if not isinstance(med, dict) or not re.fullmatch(r"\d{1,10}", str(med.get("rxcui", ""))): raise ValueError("Select an exact medication and strength from search.")
        quantity = float(med.get("quantity", 30))
        days = int(med.get("days", 30))
        if not 0 < quantity <= 100000 or days not in (30, 60, 90): raise ValueError("Choose a valid quantity and 30, 60, or 90 days supply.")
        validated.append({"rxcui": str(med["rxcui"]), "name": str(med.get("name", "Medication"))[:240], "quantity": quantity, "days": days})
    return {"state": state, "medications": validated}


def cost_rule(row, suffix):
    kind = row.get("COST_TYPE_" + suffix)
    amount = row.get("COST_AMT_" + suffix)
    if kind not in ("1", "2") or not amount: return None
    return {"type": "copay" if kind == "1" else "coinsurance", "amount": float(amount), "minimum": row.get("COST_MIN_AMT_" + suffix), "maximum": row.get("COST_MAX_AMT_" + suffix), "deductible_applies": row.get("DED_APPLIES_YN") == "Y"}


def compare(profile):
    profile = validate_profile(profile)
    year = enrollment_context()["year"]
    source = data.metadata(year)
    if not source: raise ValueError("CMS data is still loading. Check the data status and try again shortly.")
    with closing(data.connect(year)) as db:
        region = db.execute("SELECT region FROM regions WHERE state=?", (profile["state"],)).fetchone()
        if not region: raise ValueError("No PDP region was found for that state or territory.")
        plans = []
        for row in db.execute("SELECT * FROM plans WHERE region=?", (region[0],)):
            plan = dict(row)
            plan["medications"] = []
            for med in profile["medications"]:
                matches = [dict(r) for r in db.execute("SELECT DISTINCT tier,pa,st,ql,ql_amount,ql_days FROM drugs WHERE formulary=? AND rxcui=?", (plan["formulary"], med["rxcui"]))]
                # Keep all proxy-NDC variants; do not arbitrarily pick the cheapest tier.
                tiers = sorted(set(r["tier"] for r in matches))
                restrictions = []
                if any(r["pa"] == "Y" for r in matches): restrictions.append("Prior authorization")
                if any(r["st"] == "Y" for r in matches): restrictions.append("Step therapy")
                if any(r["ql"] == "Y" for r in matches): restrictions.append("Quantity limit")
                indications = [r[0] for r in db.execute("SELECT disease FROM indications WHERE plan_key=? AND rxcui=?", (plan["id"], med["rxcui"]))]
                if indications: restrictions.append("Indication-specific coverage")
                options = []
                for tier in tiers:
                    for r in db.execute("SELECT data FROM costs WHERE plan_key=? AND tier=? AND days=? AND level=1", (plan["id"], tier, {30: 1, 90: 2, 60: 4}[med["days"]])):
                        cost = json.loads(r[0])
                        options.append({"tier": tier, "preferred": cost_rule(cost, "PREF"), "standard": cost_rule(cost, "NONPREF"), "mail": cost_rule(cost, "MAIL_PREF")})
                limits = [{"amount": r["ql_amount"], "days": r["ql_days"]} for r in matches if r["ql"] == "Y"]
                plan["medications"].append({**med, "listed": bool(matches), "tiers": tiers, "restrictions": restrictions, "quantity_limits": limits, "indications": indications, "cost_sharing": options, "annual_cost": None})
            plan["listed_count"] = sum(m["listed"] for m in plan["medications"])
            plan["restriction_count"] = sum(len(m["restrictions"]) for m in plan["medications"])
            plan["annual_premium"] = round(plan["premium"] * 12, 2)
            plan["annual_total"] = None
            plan["finder_url"] = "https://www.medicare.gov/plan-compare/?" + urlencode({"year": year, "lang": "en"})
            plans.append(plan)
    # This is a screening order, explicitly not a claim about cheapest overall.
    plans.sort(key=lambda p: (-p["listed_count"], p["premium"], p["restriction_count"], p["name"]))
    return {"year": year, "state": profile["state"], "plans": plans, "source": source, "sort": "Most medications listed, then lowest monthly premium", "caveat": "Drug-list matches are screening results, not a guarantee of coverage. Confirm pharmacy network, indication, quantity limits and final costs before enrolling."}
