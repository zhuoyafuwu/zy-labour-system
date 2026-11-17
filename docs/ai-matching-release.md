# AI matching coordinated release packet

## Prepared source

Base main: 456da60. Working branch: codex/ai-worker-matching in /workspace/zy-labour-next. Earlier unpushed fee-note-compatible Scheme A, warehouse and local simplified-company changes have been merged; the durable background task implementation is retained. No branch has been pushed and no production action has been executed from this environment. Supabase MCP is available only in the user's separate local chat.

## Approval item A: database migrations

Apply in order, only after comparing actual hosted migration history (the online remove_ai_recognition_quota may already exist under a different timestamp):

1. 202611180001_unlimited_ai_and_tasks.sql: remove recognition/classification caps, keep counters/two-second recognition cooldown, return compatibility remaining=9999, retire midnight waiting, worker-first queue, three-success batch recovery, and persisted leased item IDs. Existing daily_limit becomes unused metadata.
2. 202611180002_ai_matching.sql: private profile/result/inference-job/usage tables with RLS and revoked direct access; member-read RPCs and service-only writes, active-member/maintenance checks, hash validation, stale-worker rejection, lease fencing, attempt limit and explicit-reanalysis cooldown. No business rows are rewritten.
3. 202611180003_auto_classification.sql: after-save triggers enqueue changed allowed inputs and worker profiles. Trigger installation does not backfill existing records or call a provider. Existing admin task behavior is preserved.

Record current business counts/revisions first; older 325/326/333 counts are historical, not the release baseline. No backup or data cleanup is forced (the owner previously waived backup). Do not rerun historical seed/base migrations. Verify migration history and function definitions after applying.

## Approval item B: Edge Functions and scheduler

Deploy recognize-order (unlimited embedding gate and updated diagnostics), classification-worker (profiles plus occupation batches), and new ai-matching with contracts.ts/service.ts. The new function imports the existing dist/business-time.js and dist/order-parser.js as shared publication checks; deploy from the repository root with dependency bundling, not by copying only index.ts in SQL Editor. Keep all current AI provider/model/origin secrets; never print or replace them. Actual member checks remain in functions, consistent with verify_jwt=false in config.toml. Do not blindly change the existing hosted JWT setting.

The existing scheduler/Vault secret remains unchanged. Confirm it invokes the freshly deployed classification-worker and that old leases expire or drain before rolling out the changed task finish function. Pause the task briefly for coordinated migration if needed, with explicit owner approval. Do not reset attempts, delete pending jobs, start all-data reprocessing or change the schedule without including that action in approval.

## Approval item C: main / Pages release

A main push deploys Pages. Publish the merged frontend together with the above backend: default all dates, no quota UI, AI grades/reasons/profile, rule reference, progressive batches, failure fallback, warehouse/Scheme A and local OpenCC company text. Current old-order conversion remains a separate explicit preview/backup/confirm action and must not run as part of this release. Keep old private design previews out of the commit.

## Live acceptance (separate explicit actions)

Inspect counts/revisions before and after metadata-only deployment. Use local synthetic fixtures for business examples; do not create real production test workers/orders. If live synthetic/model probes are approved, measure profile <30s, first all-ready matching <60s and cached repeat <1s; capture only timings/counts and nonidentifying error codes. Do not claim these targets from mocks. Check an old-date eligible order, strict age/gender exclusions, one new-order-only inference, manual cache precedence, worker-first batches, 3-success recovery, 6-attempt stop and provider outage fallback.

The scheduled worker may process already authorized pending work once deployed. Ask the owner whether to pause/drain existing work before deployment. No personal records, secrets, request bodies or live screenshots belong in source/tests.

## Verification performed locally

Local checks passed: npm run check, TypeScript no-emit checking of all three Edge entrypoints (with Deno ambient declarations), npm run test:parser, npm run test:transport, npm run test:postgres, npm test (10 API tests), scripts/smoke.py, scripts/workflow_smoke.py, scripts/matching_smoke.py (two timezones), scripts/company_text_smoke.py, tests/ai-matching.ts and scripts/ai_matching_smoke.py. Tests use temporary SQLite/PGlite stores and mocked providers. New tests: tests/ai-matching.ts and scripts/ai_matching_smoke.py, alongside all existing parser/transport/PostgreSQL/API/form/workflow/timezone suites. The legacy classification task test intentionally checks the pre-new-migration schema separately; the new suite checks unlimited counters and current triggers/leases.
