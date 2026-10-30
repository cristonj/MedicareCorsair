# MedicareCorsair

A local-first Medicare comparison app with a short coverage walkthrough, automatic CMS data, and Medicare results import. Python 3.11+, Node.js 22+, and a browser. No Medicare API key is required for public CMS data or document import.

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

## Netlify

`netlify.toml` builds a static frontend in `netlify-public/` and publishes only its browser assets. Connect this repository in Netlify and use the settings from the file. This is a frontend preview only: the current Python server runs on localhost, so `/api/` calls, comparison data, PDF imports, and `/extension.zip` will not work on Netlify. The extension recognizes the Netlify site, but importing its results also needs the API. A usable hosted deployment needs a separately hosted production API with persistent CMS data, a same-origin `/api/*` proxy, and an updated privacy notice. Do not expose the current development server directly to the internet.

## Windows launcher

The Windows launcher and macOS app open `https://medicarecorsair.netlify.app/` and guide unpacked extension setup in Chrome or Edge. Firefox uses a temporary add-on that must be reloaded after each Firefox restart. Safari is not supported. The launcher copies the extension to the user's profile and places its path on the clipboard; the user completes browser setup. These are development distributions, not store installations. The hosted API must be deployed separately for the website to function.

To rebuild on Windows, create the virtual environment, install `pyinstaller==6.22.3` in it, then run `./build-windows.ps1`. The resulting executable is `dist/MedicareCorsair.exe`.

The desktop workflow can be run manually to download Windows and macOS build artifacts. Pushing a version tag such as `v1.0.0` also creates a GitHub release with both builds and their SHA-256 checksums. The Windows executable is unsigned, and the macOS app is unsigned and not notarized. The extension requires developer-mode setup; Firefox's temporary installation is removed when the browser closes. The macOS and Firefox flows require testing on their target platforms.

The website requires the extension before displaying the form. It detects the extension in the current browser, rather than verifying execution of the EXE. The download button points to the latest GitHub release asset, so a version-tag release must be published before that link can work. After loading the extension unpacked, reload the website or select Check setup. The hosted API is still required for comparisons.

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

**Live, unattended pharmacy quotes remain incomplete.** The browser extension or imported Medicare printouts can supply all displayed annual totals together. Use Get Medicare prices, review the extracted amounts, confirm the medication/location/pharmacy context, and compare the lowest imported annual estimate. Monthly CMS files do not include drug-specific negotiated prices. The public quarterly pricing data lags and must not be silently reused for a different benefit year. Pharmacy network data is also not imported. The app shows these costs as unknown until an estimate is entered or Medicare results are imported. A direct unauthenticated request to the observed Medicare search endpoint returned HTTP 401 (API key required); we do not copy browser credentials into the app.

A copay or coinsurance rule is not an annual drug estimate: deductibles, drug unit prices, pharmacy status, benefit stages, insulin/vaccine rules, assistance, indication, quantity limits, and individual circumstances matter. The app does not calculate annual drug spending from tier copays or claim network status. It does not perform enrollment. Employer/retiree and unsure users receive a coverage-check route. Advantage results can be imported and compared on drug-plus-premium estimates, medical spending limits, and displayed doctor copays; provider networks and complete medical spending are not independently verified. A drug-list match does not guarantee coverage.

The next production milestone is an authorized current-year plan/pharmacy quote integration, validated against Plan Finder for real profiles, with data rights and refresh guarantees. Public hosting also needs a production app server, persistent storage volume, HTTPS, appropriate request limits, operational monitoring, and privacy review. The current privacy notice describes the local version only.

## Data and privacy

Runtime data is in ignored `data/`; override it with `CORSAIR_DATA_DIR`. The updater reads the CMS catalog, selects an archive by its benefit-year filename, then validates `CONTRACT_YEAR` inside the formulary. Downloads only compact plan/formulary/cost-sharing/geographic/indication files from the larger CMS archive. No ZIP paths are extracted to disk. SQLite indices use CMS RxCUI and formulary IDs without guessing equivalent medications.

Only the state and medication list are sent to the local comparison service; coverage setup and provider preferences stay in the browser. Uploaded PDFs are parsed locally; image PDFs use local Tesseract OCR with installed English language data. Temporary page images are deleted after extraction, and the source PDF is not retained by the service. Saved HTML is parsed as text without executing scripts. Import results require review and a coverage-year match; missing and ambiguous prices are rejected. Medication search text goes through that service to NLM. Optional saved lists and quotes remain in browser local storage, and exported files stay under the user's control. See `privacy.html`. The operator/contact in that notice is Criston Jackson, jacksoncris44@gmail.com.

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

## Coverage setup and guided collection

The four short setup screens collect current coverage, priorities, plan names, preferred pharmacies/providers, and help with costs. Original Medicare users see separate Part D screening. Advantage users see an Advantage import route with medical limits and copays. The app does not treat the lowest drug-plus-premium amount as a complete medical-cost recommendation; ties remain explicit.

Get Medicare prices offers an extension or an interactive PDF guide. The guide handles multiple result pages separately from physical PDF pages and accepts several files in one upload. Batch imports remove duplicates, reject conflicting totals/years, report incomplete result sets, and exclude health-only plans from health-and-drug comparisons.

## Browser extension (Chrome / Edge)

Download the extension from http://127.0.0.1:8000/extension.zip or load the repository's `extension/` folder unpacked. In Chrome/Edge, open Extensions, enable Developer mode, choose Load unpacked, and select the extracted folder. Use the dashboard in that same browser.

On an existing Medicare search-results tab, click MedicareCorsair's extension and Collect all result pages. It returns to page one, follows Next, verifies every expected plan was collected, and stops if pagination stalls or the search changes. Send to MedicareCorsair opens the review table. Save a copy exports one JSON file for the regular importer. No account credentials, browser cookies, or private network headers are read. The extension's collected results live in extension session storage, replaced on the next collection and cleared when that browser session ends.

The extension is a local development build, not a Chrome/Edge store release. Its collection logic is covered by pagination and failure tests. Live Medicare page traversal and five-page import were verified through the browser; the unpacked extension itself still needs installation/integration testing in Chrome/Edge. It reads completed result pages; entering the Medicare questionnaire remains guided rather than automatic.

Additional check:

```sh
node --test tests/test_extension.cjs
```
