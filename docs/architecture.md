# Architecture and next milestones

Browser → loopback Python HTTP service → indexed CMS SQLite snapshot.

The updater runs independently of visitor activity. CMS catalog discovery and selective HTTP range reads fetch only relevant nested archives. Imports go into a new database, validate coverage year and nonempty plan/formulary data, and replace the active snapshot only after a completed commit and closed connection. No old-year fallback is allowed. Readers use short-lived SQLite connections.

Medication search calls NLM through a bounded, throttled, in-memory cache. Comparisons use exact RxCUI IDs. They retain all tier/restriction variants instead of selecting an optimistic one. Initial-coverage cost-sharing rules use CMS coverage level 1 and the correct supply codes: 1=30, 2=90, 4=60 days.

The four-screen coverage intake stays in the browser. Only the state and exact medications are sent for stand-alone Part D screening. The app does not collect beneficiary IDs, log medication URLs, store medical profiles on the server, automatically substitute medications, or submit enrollment forms. Profiles live only in memory. Quotes include the coverage year, CMS release, state, ZIP, coverage type, assistance status, pharmacy preferences, exact medications, quantities and supply lengths in their context fingerprint; a change makes the quote inapplicable.

Schema 2 adds an H/R-contract Advantage catalog for validating imported plan identities. S-contract formulary screening remains separate. Advantage comparisons use reviewed imported drug-plus-premium totals, in-network medical limits and displayed primary/specialist copays. Tied drug estimates stay explicit; medical limits break display-order ties but do not establish the best overall plan. Health-only plans are excluded from health-and-drug comparisons. Provider directories, eligibility and full medical spending are not independently verified. Employer/retiree and unsure profiles receive a coverage-check route.

## Remaining production work

1. Contract for or otherwise obtain an authorized quote source covering current-year drug unit prices and exact pharmacy networks. Do not use an undocumented Medicare internal endpoint as a stable production API.
2. Add an independently validated annual Part D cost engine only when all needed inputs and benefit rules are available; include insulin, vaccines, subsidies, phase progression, noncovered drugs and limits. Cross-check against official Plan Finder.
3. Add plan detail URLs and pharmacy directory lookups from reliable maintained sources; retain direct official fallback links for unavailable steps.
4. Deploy behind a production server with HTTPS, background job scheduling, persistent database volume, backups, rate limits and monitoring. Local auto-refresh requires the process to run; a hosted worker would keep it independent of the user's computer.
5. Review health-data privacy obligations before collecting accounts, profiles, uploads, insurance credentials or broader integrations. Update the privacy notice to match the deployed behavior.

No terms acceptance gate is included, per the owner's request.

## Medicare printout import

The observed guest Plan Finder flow produced current 2027 drug-plus-premium totals. Its search request sends location/year as query parameters and the NDC, quantity, frequency, selected pharmacy NPIs, and subsidy level in a JSON POST body. The shareable page URL alone does not reproduce the medication profile. A direct request without browser authorization returned 401 (API key required). No browser authorization headers or credentials were copied or stored.

An import path reads batches of Medicare results-page printouts, saved HTML, copied text, or one extension JSON collection. The interactive guide distinguishes result-page pagination from physical PDF pages and asks for all saved files together. PDFium reads embedded text when present; image pages are rendered to bounded local images and processed by local Tesseract with installed language data. No remote OCR is used. Rendered pages stay in memory. The source file and extracted full text are not retained by the service.

The parser associates plan IDs, explicit annual-total year labels, monthly premiums and drug-plus-premium totals. It normalizes only a common OCR S/$ confusion within labeled plan IDs, then checks IDs against CMS. It rejects different benefit years, conflicting duplicate totals, missing values, ambiguous amounts, and totals smaller than annual premiums. The user reviews all amounts and confirms the same medication, location, assistance and pharmacy inputs before applying them. These inputs are not present in the results printout itself. Imports are user-supplied records, not authenticated Medicare responses. The UI labels their source and date.

The supplied nine-page image PDF was successfully read into 10 plan estimates; totals were compared with the visible guest results. A five-page Advantage comparison was traversed in the browser and imported as 42 health-and-drug plans after excluding six health-only plans. Batch imports deduplicate plan IDs, reject conflicting prices or benefit years, and report incomplete result counts when a pagination label is available.

## Browser extension

The optional Manifest V3 extension uses activeTab and scripting to read visible Medicare result-page text only when invoked. It returns to the first results page, follows visible Next controls, verifies search context and unique plan counts, and rejects stalled or incomplete collection. No cookies, account credentials, authorization headers or private endpoints are read. The extension sends collected results directly to an open dashboard for extraction and review, without persisting captures. GET /extension.zip packages the checked-in extension sources for unpacked Chrome/Edge installation.

The extension has not been installed or integration-tested in Chrome/Edge. Automated tests cover collection from a later page, stalled/missing pagination, and narrow permissions. Actual live multi-page traversal and local import were checked separately through the browser. The Medicare questionnaire still requires guided entry; the extension collects completed results. Store packaging and full installation testing remain.

Imported quotes do not refresh themselves when Medicare prices change. Public CMS plan data updates automatically while the server runs; new drug quotes require another extension collection, new printouts, or a future authorized live integration.
