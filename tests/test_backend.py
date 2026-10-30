from contextlib import closing
from datetime import date
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from backend.calendar import enrollment_context
from backend import data
from backend.compare import compare, cost_rule, validate_profile


def fixture(year=2027):
    # Synthetic test-only data. Never served by the app.
    texts = {
        "plan information": "CONTRACT_ID|PLAN_ID|SEGMENT_ID|CONTRACT_NAME|PLAN_NAME|FORMULARY_ID|PREMIUM|DEDUCTIBLE|MA_REGION_CODE|PDP_REGION_CODE|STATE|COUNTY_CODE|SNP|PLAN_SUPPRESSED_YN\nS0001|001|000|Test org|Test plan|00001|12.50|600||17|||0|N\nH0001|001|000|Test MA|Test MA|00002|0|0|||IL||0|N\n",
        "geographic locator": "COUNTY_CODE|STATENAME|COUNTY|MA_REGION_CODE|MA_REGION|PDP_REGION_CODE|PDP_REGION\n01000|Illinois|Test County|||17|Illinois\n",
        "basic drugs formulary": f"FORMULARY_ID|CONTRACT_YEAR|RXCUI|NDC|TIER_LEVEL_VALUE|PRIOR_AUTHORIZATION_YN|STEP_THERAPY_YN|QUANTITY_LIMIT_YN|QUANTITY_LIMIT_AMOUNT|QUANTITY_LIMIT_DAYS\n00001|{year}|123|00000000001|2|Y|N|Y|30|30\n",
        "beneficiary cost file": "CONTRACT_ID|PLAN_ID|SEGMENT_ID|TIER|DAYS_SUPPLY|COVERAGE_LEVEL|COST_TYPE_PREF|COST_AMT_PREF|COST_TYPE_NONPREF|COST_AMT_NONPREF|DED_APPLIES_YN\nS0001|001|000|2|1|1|1|5|2|0.25|Y\n",
        "indication based coverage": "CONTRACT_ID|PLAN_ID|RXCUI|DISEASE\n",
    }
    outer = io.BytesIO()
    with zipfile.ZipFile(outer, "w") as archive:
        for prefix, content in texts.items():
            inner = io.BytesIO()
            with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as nested: nested.writestr("file.txt", content)
            archive.writestr(prefix + ".zip", inner.getvalue())
    outer.seek(0)
    return outer


class CalendarTests(unittest.TestCase):
    def test_annual_boundaries_and_december_retention(self):
        for when, year, active in [(date(2026,10,14),2026,False), (date(2026,10,15),2027,True), (date(2026,12,7),2027,True), (date(2026,12,8),2027,False), (date(2027,1,1),2027,False), (date(2027,10,15),2028,True)]:
            with self.subTest(when=when):
                context = enrollment_context(when)
                self.assertEqual(context["year"], year)
                self.assertEqual(context["annual_open_enrollment"], active)


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.source = {"year":2027, "url":"https://data.cms.gov/2027_20261008.zip", "modified":"2026-10-15"}
    def tearDown(self): self.temp.cleanup()

    def test_release_date_is_not_benefit_year(self):
        catalog = {"dataset":[{"title":data.TITLE + " : 2026-10-15", "distribution":[{"downloadURL":"https://data.cms.gov/files/2027_20261008.zip"}, {"downloadURL":"https://data.cms.gov/files/2026_20260916.zip"}]}]}
        self.assertIn("2027_", data.discover(catalog,2027)["url"])
        self.assertIn("2026_", data.discover(catalog,2026)["url"])
        with self.assertRaises(ValueError): data.discover(catalog,2028)

    def test_year_mismatch_is_rejected(self):
        with patch.object(data,"RemoteZip",return_value=fixture(2026)):
            with self.assertRaisesRegex(ValueError,"year mismatch"):
                data.build_snapshot(self.source,self.path/"bad.sqlite")

    def test_real_import_path_and_unknown_prices(self):
        with patch.object(data,"RemoteZip",return_value=fixture()):
            source = data.build_snapshot(self.source,self.path/"plans-2027.sqlite")
        self.assertEqual(source["plan_count"],1)  # PDP screening stays separate.
        self.assertEqual(source["schema"],2)
        with closing(sqlite3.connect(self.path/"plans-2027.sqlite")) as db:
            self.assertEqual(db.execute('SELECT id,name FROM ma_plans').fetchall(),[('H0001-001-000','Test MA')])
        with patch.object(data,"DATA",self.path), patch("backend.compare.enrollment_context",return_value={"year":2027}):
            result = compare({"state":"Illinois","medications":[{"rxcui":"123","name":"Test drug","quantity":30,"days":30}, {"rxcui":"999","name":"Missing drug","quantity":30,"days":30}]})
        plan = result["plans"][0]
        self.assertEqual(plan["annual_premium"],150)
        self.assertEqual(plan["listed_count"],1)
        self.assertIsNone(plan["annual_total"])
        self.assertIsNone(plan["medications"][1]["annual_cost"])
        self.assertEqual(plan["medications"][0]["restrictions"],["Prior authorization","Quantity limit"])
        rules = plan["medications"][0]["cost_sharing"][0]
        self.assertEqual(rules["preferred"]["amount"],5)
        self.assertEqual(rules["standard"]["type"],"coinsurance")
        self.assertIsNone(rules["mail"])

    def test_failed_sync_preserves_last_snapshot_and_unlocks(self):
        dest = self.path/"plans-2027.sqlite"
        dest.write_bytes(b"last known good")
        with patch.object(data,"DATA",self.path), patch.object(data,"json_get",side_effect=OSError("network down")):
            data.sync()
        self.assertEqual(dest.read_bytes(),b"last known good")
        self.assertFalse(data.STATE["running"])
        self.assertFalse(data.LOCK.locked())
        self.assertIn("network down",data.STATE["error"])

    def test_partial_import_failure_does_not_replace_snapshot(self):
        dest = self.path/"plans-2027.sqlite"; dest.write_bytes(b"old")
        def broken(source, path): path.write_bytes(b"partial"); raise ValueError("schema change")
        with patch.object(data,"DATA",self.path), patch.object(data,"enrollment_context",return_value={"year":2027}), patch.object(data,"json_get",return_value={}), patch.object(data,"discover",return_value=self.source), patch.object(data,"metadata",return_value=None), patch.object(data,"build_snapshot",side_effect=broken):
            data.sync()
        self.assertEqual(dest.read_bytes(),b"old")
        self.assertFalse((self.path/"plans-2027.next.sqlite").exists())


class ValidationTests(unittest.TestCase):
    def test_bad_profiles(self):
        for med in [{"rxcui":"<script>"},{"rxcui":"123","quantity":float("nan")},{"rxcui":"123","quantity":0},{"rxcui":"123","days":29}]:
            with self.subTest(med=med), self.assertRaises(ValueError): validate_profile({"state":"Illinois","medications":[med]})
    def test_not_offered_is_not_zero_cost(self):
        self.assertIsNone(cost_rule({"COST_TYPE_PREF":"0","COST_AMT_PREF":"0"},"PREF"))
        self.assertEqual(cost_rule({"COST_TYPE_PREF":"1","COST_AMT_PREF":"0"},"PREF")["amount"],0)


if __name__ == "__main__": unittest.main()
