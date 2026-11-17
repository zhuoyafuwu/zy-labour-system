# Background classification: deployment record (scheduler disabled)

## Baseline and reconciliation

Repository: zhuoyafuwu/zy-labour-system, main commit `fefbe5005d788dbee4d3dab144b0113ece881732`.
Read AGENTS.md, classification-v2-release.md, matching-rules.md, recognition-rules.md and the recognition error catalog before implementation.
Hosted recognize-order was read through Supabase MCP: ACTIVE, version 12, JWT verification enabled, bundle hash `18cb41ccbd5b0b37221630c3fe63aca75d42950edd6fa6b68944d38129a434cb`.

Main is older than hosted v12. This package brings its classification handler forward to the inspected v12: fixed diagnostic codes, provider distinctions, 60-second batch / 20-second interactive model timeout, and rejection of `other` cache writes. index.ts includes the hosted embedded `other` guard. The only additional handler hook is an internal taskTaxonomy snapshot, supplied by the service-only worker and never forwarded from a browser body. match-profile.ts and validation.ts behavior is unchanged.

This comparison does not recover unpublished edits in the old cloud chat. Do not treat main, this package or that chat as identical. Reconcile any recovered edits before release. Do not overwrite hosted recognize-order from old main. Its existing JWT setting is true while main's config.toml says false; this release does not require redeploying recognize-order or changing its hosted JWT setting.

## Implemented behavior and boundaries

- Private tasks/items persist source snapshots, progress, attempts, next-run time and fenced leases.
- One task can be active; repeated Start joins it. Admin controls support start, status, pause and resume. Resume after terminal failure requeues only failed items; an active quota wait is preserved.
- The browser submits one RPC, then can close. It sends no business source payload and holds no execution loop. The UI adds only a submission toast, with English translation.
- A scheduler tick claims up to eight units. The existing classification handler uses the same SHA-256 v2 cache contract, manual protection, independent reservation RPC and model/evidence validation. Each completed batch persists caches, then progress. A process death between those commits is recovered through the cache after lease expiry.
- Truncated/invalid/oversized output or invalid input halves the persistent batch size. Singleton failure is terminal. Other transient failures have a six-attempt item ceiling; explicit resume is required after terminal exhaustion. No infinite retry or silent success for an unclassified item.
- Fifty existing team reservations per Shanghai day remain unchanged. Failed paid calls still count; quota denial defers until Shanghai midnight without consuming the retry allowance. Recognition quotas are separate.
- The initial 40 caches are neither migrated nor cleared. The three manual cache rows retain priority, even if a model attempts another classification. Records with an overall manual matchProfile are skipped.
- Tasks update shared classification caches/dictionary and their own queue metadata only. They do not invoke zy_job_profiles_apply, update order_state/workers, increment business revisions, alter amounts/raw text or change human review results. Existing matching reads the shared cache.
- Snapshot scope is stored order title/workContent and worker history/intents/certificates, independent of browser publication filtering. Original documents are never reparsed. The old 329 ready/deduplicated UI count is not this task's progress denominator. Requirements, amounts, contact fields and review metadata are excluded from task/model inputs. Employer is retained only as an occupational history clue, matching the v2 allowlist.
- Later source edits do not make an old cache current: matching recomputes the source input hash. New/edited records after the snapshot enter a new explicit task; this release is a durable submitted job, not a database trigger on every edit.
- Maintenance prevents claims; revoked/non-admin owners pause. Pause does not cancel an already running model request, which may commit its current classification metadata. Scheduler credentials are server-only.

## Specific deployment proposal — approval required

Nothing below has been executed against production.

1. **Migration:** apply only `supabase/migrations/202611170001_classification_tasks.sql` after the existing v2 migration. It creates two private tables and four RPCs: zy_classification_task_control, zy_classification_task_claim, zy_classification_task_finish, and service-only zy_classification_worker_authorized. It seeds no tasks, changes no quota settings, replaces no existing functions, and rewrites no business/cache rows.
2. **Worker:** deploy only the new `classification-worker` function with index.ts, runner.ts and imported recognize-order/classification-handler.ts plus match-profile.ts. Its config disables gateway JWT verification because the handler checks a dedicated scheduler secret. Existing recognize-order stays on hosted v12; no deployment is needed for it. Existing model configuration and server-only service credentials are reused.
3. **Secrets:** generate a fresh random 64-character credential inside Supabase Vault as zy_classification_worker_secret, and store `https://fjpvgxfkerbnqcctclqo.supabase.co/functions/v1/classification-worker` as zy_classification_worker_url. The worker validates the presented credential through the service-only zy_classification_worker_authorized RPC; no Edge secret-setting API is required. Never put the credential in the repository, frontend or chat.
4. **Scheduler:** separately review/apply `supabase/schedules/classification-worker.sql`. It enables pg_cron/pg_net if missing and registers `zy-classification-worker` every minute with a 120-second HTTP timeout. The transaction leaves the job **disabled**. It only dispatches when a due task exists, its lease is free, and maintenance is off. This follows Supabase's scheduled Edge Function pattern: https://supabase.com/docs/guides/functions/schedule-functions .
5. **Frontend:** publish classification-admin.js, supabase-adapter.js and i18n.js together after the migration/worker are installed. No business UI fields change. Pushing main may deploy Pages, so nothing has been pushed as part of this package.
6. **Activation / production execution:** enable the cron job and start/resume a task only under explicit authorization to run production classification. Backend installation, scheduler activation and first real AI run are separate reviewable actions. A read-only before/after audit should compare the 3 manual caches, business data/revisions, quota counters and task state without exporting private records into fixtures.

For a stop/rollback, disable the named cron job and pause the task; preserve queue/cache tables. Revert frontend submission code if needed. Do not drop tables or delete saved results. A running batch may finish; disabling cron prevents subsequent batches.

## Local verification

All fixtures are synthetic; model HTTP responses are mocked. No production AI, backfill, data writes, deployments, scheduler changes, GitHub pushes or publications were performed.

Passed:

- Syntax/manifest checks (`check`).
- Existing parser/matching/recognition suite (`test:parser`).
- Existing Supabase adapter and DeepSeek/Gemini transport tests (`test:transport`). The quota mock now returns PostgreSQL's actual 54000 code, preserving the quota assertion while matching v12 diagnostics.
- Existing PostgreSQL/SQLite portability and taxonomy tests (`tests/postgres.mjs`, `tests/job-taxonomy.mjs`).
- Durable-task test against real PostgreSQL semantics in PGlite plus actual runner/handler code (`tests/classification-tasks.ts`): 40 existing caches / 3 manual rows unchanged; no model calls for cache-only work; task dedup; fenced process-death recovery; save/resume; repeated 8→4→2→1 truncation (11 bounded calls for eight failures); failed-item resume; independent quota wait; permissions, maintenance and revoked owners; exact business JSON/version preservation.
- Worker endpoint auth (`tests/classification-worker-auth.ts`): rejects user/service tokens and unauthenticated requests, accepts only the dedicated scheduler credential, no model request without a task.
- Frontend submission (`tests/classification-task-ui.mjs`): one task submission, no browser batch/profile loop, failure restores the button.

**Outstanding:** scripts/smoke.py and classification_admin_smoke.py were attempted with installed headless Chrome, but Chrome exited with SIGABRT before the first page opened. These browser assertions have not passed here. Both scripts now accept ZY_CHROMIUM_PATH while retaining their Linux default. The admin browser regression was updated for server submission/cache refresh; dictionary editing, manual assignment, bilingual/mobile and staff visibility assertions remain. Actual hosted pg_cron/pg_net dispatch and runtime bundling are not covered by PGlite and need deployment acceptance after authorization. Frontend browser smoke remains outstanding; hosted deployment status is recorded below.

## Deployment on 2026-11-17 (Shanghai date)

The owner authorized publication. Applied classification_tasks and classification_worker_schedule_disabled migrations, provisioned scheduler credentials internally in Vault, and deployed classification-worker v1. recognize-order remains hosted v12 with JWT verification enabled. The cron job is installed but disabled; there are zero classification tasks. Before/after digests for orders, workers and the three manual caches are identical; cache count stays 40 and daily cap stays 50. Frontend publication is tracked by this commit's GitHub Pages workflow. Production AI execution and scheduler activation were not authorized or performed.
