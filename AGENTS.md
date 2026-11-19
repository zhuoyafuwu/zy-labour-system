# Repository working instructions

## Human edits are final (non-negotiable)

1. A human Save stores exactly what the person entered. The only permitted transformation is Traditional-to-Simplified Chinese conversion of company-order text. No punctuation, wording, bracket, salary-format or whitespace rewriting (removing invisible control characters is allowed).
2. A human Save may be blocked only by: empty job title, duplicate company code, or missing gender. Every other check (brackets, quote/fee/deduction wording, salary format, review acknowledgement, multi-order detection) is a non-blocking warning shown next to the field.
3. Recognition helpers (ZYOrderParser sanitize/validate/repair/present and their successors) run only on new source recognition and previews. The human save path must not call them.
4. No automated process (login repair, AI classification, AI matching, background tasks, migrations) writes company orders or worker records. They write only their own tables. Any one-off data change needs an explicit, separately approved script with a backup.
5. A change that violates any rule above must not ship, even if all tests pass. Do not weaken or delete the human-save regression tests to make a change pass.


## Recognition work

Before changing source-order recognition, read:

1. `docs/recognition-rules.md` for the current contract and precedence rules.
2. `tests/fixtures/recognition-errors.json` for the documented error families and their causes.
3. The relevant parser, mechanism, and browser tests.

Use the shared `ZYOrderParser` document pipeline for new source recognition and explicit recognition previews only. It must not participate in human saves or block copying a human-edited order. Do not reintroduce position-specific extraction branches, duplicate inline handlers, fixed-row extraction, or unrecorded drops of unknown text.

For each recognition defect, add or extend a synthetic error-catalog case and an executable regression. Include a nearby counterexample that the fix must preserve, such as quotation documents versus supplier quotations, employee deductions versus agency fees, or physical quantities versus amounts. Real applicants, live orders, credentials, and backups must never enter fixtures.

Before release, run `npm run check`, `npm run test:parser`, and, for changes affecting forms, saved metadata, or publication, `python3 scripts/smoke.py`. Fix regressions rather than removing cases or weakening unrelated assertions. Pages deployment runs the parser release checks as well.

Keep source archives and existing manual edits intact. No bulk recognition rewrite or database migration is needed for parser changes. Existing records use explicit preview, review, and save. Recognition audit metadata belongs to private business records, never copied company publication text.

## Communication and documentation

Repository documentation is in English. Chinese business examples and interface strings remain where functionally required. Website changes retain the Chinese/English interface switch and never translate business records automatically. Update `docs/update-log.md` when behavior changes. Provide the website link after verified deployment; do not provide screenshots unless requested.

## Business dates

Business dates and displayed times use `Asia/Shanghai` exclusively through `ZYTime`. Keep stored instants in UTC and preserve literal worker calendar dates; never use device-local date arithmetic for business rules.
