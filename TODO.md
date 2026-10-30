# Resume checklist — October 30, 2026

User requested stopping at this checkpoint and committing everything to main.
Do not describe the entire guest/Advantage flow as fully verified yet.

## Verified at this checkpoint

- 25 Python tests and 26 Node tests pass locally.
- Native helper layout checked in 36 combinations: Edge/Chrome/Firefox,
  100/125/150/200% scaling, and 820×500, 900×600, 1060×710 logical windows.
- A Windows build succeeded and its embedded manifest was inspected:
  PerMonitorV2 DPI awareness, asInvoker (no administrator requirement).
  That local EXE predates the last provider/layout edits; rebuild before sharing.
- Real Edge guest Part D run completed: ZIP 60601, atorvastatin 20 mg tablet,
  30 tablets every 30 days, CVS #04781. Corsair entered the Medicare forms,
  returned exact pharmacy choices to Corsair, collected all available results,
  and returned 10 plans for 2027. Ranking rendered after confirmation.
- Real Advantage run entered two medications, including a 90-day fill, and
  reached pharmacy selection and Medicare's provider step. It exposed the
  previously missing provider adapter, which is now implemented and unit tested.
- Latest real Advantage run successfully returned the doctor question to Corsair.
  Testing stopped there at the user's request. Doctor search and the final
  Advantage results handoff have NOT completed end to end in the latest code.
- Real Medicare provider UI was inspected: Add provider navigates to
  `#/manage-providers`; next buttons are `Add another provider` and
  `Start comparing plans`. Generated `choice--NN` IDs change between visits;
  the driver now uses labels instead.

## First tasks tomorrow

1. Finish the real Edge Advantage test, without login or enrollment.
   - Enter the sample profile in Corsair; do not fill Medicare manually.
   - Test both explicit **Skip doctor check** and doctor search/selection.
   - Confirm first/last name fields, exact provider confirmation, adding another
     provider, and `Start comparing plans` work without duplicated questions.
   - Verify all result pages return to the originating dashboard/window.
     Previous unfiltered sample searches had 48 plans over 5 pages; do not hardcode
     that count. Health-only plans are intentionally excluded by the importer.
   - Verify a matching previous guest drug list is reused, a different list needs
     confirmation, and quantities/frequencies remain correct after dosage changes.
2. Audit provider matching and recovery.
   - Provider choices currently show names; add specialty/location context where
     available so people with the same name cannot be confused.
   - Confirm the selected provider actually appears in Medicare's review before
     proceeding; retain the warning to check the exact office/network.
   - Test no matches, repeated searches, name preservation, five-provider limit,
     existing provider lists, cancel, page reload, closed Medicare tab, and errors.
   - Test **Review on Medicare** after success/error and the manual collector's
     routing back to the correct dashboard. Never send results to an arbitrary
     comparison when several dashboards are open.
3. Finish visual QA.
   - Check new results summary, price breakdown, ties, medical spending limits,
     and doctor copays. No stale “confirm first” heading after confirmation.
   - Check pharmacy picker at short desktop sizes; its main action should remain
     visible. Long option lists may scroll inside the list.
   - Run the rebuilt Windows helper on the actual display and confirm text and
     screenshots look sharp. Check the compact short-window layout and screenshot
     viewer. Layout tests alone do not establish perceived sharpness.
4. Rebuild and release after the above passes.
   - Run the checks below, rebuild Windows, inspect the DPI manifest again.
   - Check GitHub Actions on Windows, macOS ARM, and macOS Intel.
   - Publish the next desktop release and verify all latest download links.
   - Refresh the production Netlify page with the production extension and verify
     helper connectivity. Mac/Firefox and a real signed-in Medicare account still
     need target-platform/session testing; do not claim they were tested.

## Development/test setup

- Production site: https://medicarecorsair.netlify.app/
- Installed Edge extension folder:
  `%LOCALAPPDATA%\MedicareCorsair\extension\edge`.
  User explicitly approved loading/testing the update in Edge.
- Temporary localhost port 8001 permissions used for the live test were removed
  from the installed extension. Production files were copied back and Reload was
  clicked. The user also reported reloading the extension. The temporary server
  on port 8001 has been stopped. Do not leave test permissions in a release.
- To run an isolated local live test alongside the existing helper, serve the
  source frontend/API on another loopback port and temporarily add ONLY that
  owned test origin to a development extension's manifest/content-script matches
  and `dashboard()` allowlist. Restore production files afterward.
- `tests/live-guest.cjs` is an opt-in disposable Chromium test, not a normal CI
  test. It serves current frontend files through test routing and uses the real
  helper API on port 8000. Medicare returned HTTP 403 to this isolated browser's
  data requests, including a normal browser-input ZIP probe. Use the approved
  real Edge UI for live Medicare testing; do not bypass site protections or
  extract/replay private API credentials.
- `node tests/live-guest.cjs --entry-only` works for frontend visual QA without
  visiting Medicare. Test screenshots and probe files are ignored under `tmp/`.
  Playwright browsers are ignored under `build/test-browsers/`.
- Earlier extension files were backed up under ignored `build/extension-before-live/`.
- The last published desktop release before this checkpoint was v0.4.5. The
  source extension is version 0.5.0. No new release was published for this checkpoint.
- Older extensions deliberately retain guided import rather than accidentally
  starting the account flow with a guest profile. New automatic entry requires
  the `guest-autofill` capability handshake.

## Checks

```powershell
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
node --test tests/test_extension.cjs tests/test_install.cjs tests/test_guest.cjs tests/test_app.cjs
node --check app.js
node --check extension/guest.js
git diff --check
.\build-windows.ps1
```

## Files to start with

- `extension/guest.js`: staged guest form driver, exact matching, provider adapter.
- `extension/background.js`: in-memory jobs, dashboard ports, tab/window routing,
  completed/error tab links, manual collector routing.
- `extension/bridge.js`: capability handshake and volatile message transport.
- `app.js`, `index.html`, `styles.css`: two-question intake, autocomplete,
  interactive questions, comparisons, legacy extension fallback.
- `desktop.py`, `windows.manifest`, `build-windows.ps1`: native DPI/layout/build.
- `tests/test_guest.cjs`, `tests/test_app.cjs`, `tests/test_extension.cjs`,
  `tests/test_setup_layout.py`: regression coverage.

## Constraints to preserve

- Health profiles, prompts, results, and routing live only in memory. No profile
  localStorage/sessionStorage/extension storage, files, clipboard, or logs.
- Closing/reloading the initiating page disconnects its runtime port and discards
  background health-profile state. Public CMS data alone may persist on disk.
- Medicare.gov and the browser retain their own storage behavior; do not erase
  unrelated cookies or change browser security/privacy settings.
- No password handling, automatic login, guessed assistance answers, silent drug
  substitutions, automatic enrollment, or fabricated prices.
- Use the current enrollment benefit year from the helper, not a hardcoded year.
- Keep copy short, actions visible, and setup instructions specific to OS/browser.
- Keep the custom noncommercial license; do not replace it with standard MIT.
