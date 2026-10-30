# Architecture and next milestones

Browser → loopback Python HTTP service → indexed CMS SQLite snapshot.

The updater runs independently of visitor activity. CMS catalog discovery and selective HTTP range reads fetch only relevant nested archives. Imports go into a new database, validate coverage year and nonempty plan/formulary data, and replace the active snapshot only after a completed commit and closed connection. No old-year fallback is allowed. Readers use short-lived SQLite connections.

Medication search calls NLM through a bounded, throttled, in-memory cache. Comparisons use exact RxCUI IDs. They retain all tier/restriction variants instead of selecting an optimistic one. Initial-coverage cost-sharing rules use CMS coverage level 1 and the correct supply codes: 1=30, 2=90, 4=60 days.

Anonymous profiles are request-scoped. The app does not collect beneficiary IDs, log medication URLs, store medical profiles on the server, automatically substitute medications, or submit enrollment forms. Optional saved lists live in browser storage. Manual quotes include the coverage year, CMS release, state, exact medications, quantities and supply lengths in their context fingerprint; a change makes the quote inapplicable.

## Remaining production work

1. Contract for or otherwise obtain an authorized quote source covering current-year drug unit prices and exact pharmacy networks. Do not use an undocumented Medicare internal endpoint as a stable production API.
2. Add an independently validated annual Part D cost engine only when all needed inputs and benefit rules are available; include insulin, vaccines, subsidies, phase progression, noncovered drugs and limits. Cross-check against official Plan Finder.
3. Add plan detail URLs and pharmacy directory lookups from reliable maintained sources; retain direct official fallback links for unavailable steps.
4. Deploy behind a production server with HTTPS, background job scheduling, persistent database volume, backups, rate limits and monitoring. Local auto-refresh requires the process to run; a hosted worker would keep it independent of the user's computer.
5. Review health-data privacy obligations before collecting accounts, profiles, uploads, insurance credentials or broader integrations. Update the privacy notice to match the deployed behavior.

No terms acceptance gate is included, per the owner's request.

## Medicare printout import

The observed guest Plan Finder flow produced current 2027 drug-plus-premium totals. Its search request sends location/year as query parameters and the NDC, quantity, frequency, selected pharmacy NPIs, and subsidy level in a JSON POST body. The shareable page URL alone does not reproduce the medication profile. A direct request without browser authorization returned 401 (API key required). No browser authorization headers or credentials were copied or stored.

An import path now reads the Medicare results-page printout, saved HTML, or copied text. PDFium reads embedded text when present; image pages are rendered to bounded local images and processed by local Tesseract with installed language data. No remote OCR is used. Temporary images are removed. The source file and extracted full text are not retained by the service.

The parser associates plan IDs, explicit annual-total year labels, monthly premiums and drug-plus-premium totals. It normalizes only a common OCR S/$ confusion within labeled plan IDs, then checks IDs against CMS. It rejects different benefit years, conflicting duplicate totals, missing values, ambiguous amounts, and totals smaller than annual premiums. The user reviews all amounts and confirms the same medication, location, assistance and pharmacy inputs before applying them. These inputs are not present in the results printout itself. Imports are user-supplied records, not authenticated Medicare responses. The UI labels their source and date.

The supplied nine-page image PDF was successfully read into 10 plan estimates; totals were compared with the visible guest results. Imports do not refresh themselves when Medicare prices change. Public CMS plan data still updates automatically; new drug quotes require a new printout or a future authorized live integration.
