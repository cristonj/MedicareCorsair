# MedicareCorsair

A local-first Medicare Part D comparison app with real CMS data. Python 3.11+, Node.js 22+, and a browser. No Medicare API key is required for public CMS data or document import.

## Start

```sh
python -m venv .venv
# Windows:
.venv/Scripts/python -m pip install -r requirements.txt
# macOS/Linux: use .venv/bin/python instead
npm ci
.venv/Scripts/python server.py
```

Open http://127.0.0.1:8000. The service automatically discovers and imports the relevant CMS release on startup. The first import takes roughly a minute depending on network speed. It checks for updates every six hours, retries failed checks after 15 minutes, and retains the last complete snapshot if an update fails. Keep the server running for automatic updates; a closed laptop or stopped process cannot refresh. Restarting always checks again.

A standalone desktop wrapper is not needed for these public data connections. The local server is intentionally bound to loopback. It is not an internet production server.

## What works

- Enrollment-aware coverage year: annual enrollment October 15–December 7 selects the following benefit year. That year remains selected through December 31. Other times use the current benefit year, with an eligibility notice rather than a claim that annual enrollment is open.
- Automatic CMS catalog discovery, benefit-year validation, partial ZIP downloads, and atomic SQLite snapshot replacement. Never substitutes next/previous-year plans if the desired year is unavailable.
- State/territory to PDP region lookup, stand-alone plan premiums and deductibles.
- Live NLM RxNorm search with exact strength/form selection and bounded in-memory caching.
- Formulary matches, all returned proxy-NDC tiers, prior authorization, step therapy, quantity limits, and indication-specific entries.
- Initial-coverage preferred retail, standard retail, and preferred mail cost-sharing rules for 30/60/90-day supplies.
- Browser-local annual drug estimates, context invalidation, sorting, filters, printable results and downloadable checklists. Every manual task has a source link beside it.
- Optional browser storage; no server-side beneficiary accounts or stored profiles, no analytics, no access logs containing medication queries. No terms gate or required acceptance.

## What is still incomplete

**Live, unattended pharmacy quotes remain incomplete.** Imported Medicare printouts can now supply all displayed annual totals together. Use the Import Medicare PDF button, review the extracted amounts, confirm the medication/location/pharmacy context, and compare the lowest imported annual estimate. Monthly CMS files do not include drug-specific negotiated prices. The public quarterly pricing data lags and must not be silently reused for a different benefit year. Pharmacy network data is also not imported. The app shows these costs as unknown until an estimate is entered or a Medicare printout is imported. A direct unauthenticated request to the observed Medicare search endpoint returned HTTP 401 (API key required); we do not copy browser credentials into the app.

A copay or coinsurance rule is not an annual drug estimate: deductibles, drug unit prices, pharmacy status, benefit stages, insulin/vaccine rules, assistance, indication, quantity limits, and individual circumstances matter. The app does not calculate annual drug spending from tier copays or claim network status. It excludes Medicare Advantage, employer plans and enrollment actions. A drug-list match does not guarantee coverage.

The next production milestone is an authorized current-year plan/pharmacy quote integration, validated against Plan Finder for real profiles, with data rights and refresh guarantees. Public hosting also needs a production app server, persistent storage volume, HTTPS, appropriate request limits, operational monitoring, and privacy review. The current privacy notice describes the local version only.

## Data and privacy

Runtime data is in ignored `data/`; override it with `CORSAIR_DATA_DIR`. The updater reads the CMS catalog, selects an archive by its benefit-year filename, then validates `CONTRACT_YEAR` inside the formulary. Downloads only compact plan/formulary/cost-sharing/geographic/indication files from the larger CMS archive. No ZIP paths are extracted to disk. SQLite indices use CMS RxCUI and formulary IDs without guessing equivalent medications.

The profile is sent to the local comparison service. Uploaded PDFs are parsed locally; image PDFs use local Tesseract OCR with installed English language data. Temporary page images are deleted after extraction, and the source PDF is not retained by the service. Saved HTML is parsed as text without executing scripts. Import results require review and a coverage-year match; missing and ambiguous prices are rejected. Medication search text goes through that service to NLM. Optional saved lists and quotes remain in browser local storage, and exported files stay under the user's control. See `privacy.html`. The operator/contact in that notice is Criston Jackson, jacksoncris44@gmail.com.

Sources:
- [CMS monthly public-use data](https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/monthly-prescription-drug-plan-formulary-and-pharmacy-network-information)
- [CMS 2026/2027 PUF record layout](https://data.cms.gov/sites/default/files/2025-10/83da019f-fa24-483e-87de-cc089780a6a5/SPUFRecordLayout-2026.pdf)
- [NLM RxNorm API](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html)
- [Official enrollment dates](https://www.medicare.gov/health-drug-plans/open-enrollment)
- [Medicare Plan Finder](https://www.medicare.gov/plan-compare/)

## Verify

```sh
python -m unittest discover -s tests -v
node --check app.js
```

CI runs deterministic tests on Windows and Linux. Tests use synthetic fixtures, never fabricated production plan data. Refresh data without starting HTTP:

```sh
python server.py --sync-only
```
