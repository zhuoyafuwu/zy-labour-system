# Human-save deployment — 2026-11-20 (Asia/Shanghai)

Application release: `3612988525f4bad5d2a2631e0cb038d60022e107` on `main`.

Website: https://zhuoyafuwu.github.io/zy-labour-system/

## Completed changes

Applied Supabase migration `20261120002522_human_order_versions` to project `fjpvgxfkerbnqcctclqo`. The exact reviewed SQL remains in `supabase/pending-migrations/202611200001_human_order_versions.sql` as a release artifact, not an instruction to execute it again. The legacy aggregate stays read-only at revision 552. New orders start at per-record version 1; subsequent saves use the global monotonic sequence. The client receives `orderStorage: rows-v1`.

Deployed `ai-matching` v3 and `classification-worker` v4, preserving their existing `verify_jwt=false` and authenticated function bodies. Both bundles include `dist/human-save.js`, the existing shared dependencies and the 204/empty-RPC repair. `recognize-order` stays v13 with its existing JWT setting. Existing provider/model/origin secrets were neither replaced nor printed.

The main push succeeded through the existing GitHub Desktop login. Direct Git lacked credentials, and an actual connector branch creation returned 403. The old unpublished local main was retained as `preserve/unpublished-main-before-human-release`; the older workspace was untouched. The isolated implementation branch remains published.

## Verification

- Private preflight and final maintenance backups cover 17 application tables plus schema/function/grant/trigger/schedule/migration recovery metadata. They are public-key encrypted and stored outside source, output artifacts and Git. Recovery material is stored separately with restricted permissions. The final backup SHA-256 is `77500bb5caa740150219555174170f6c08b46f2cf78d2856a8de8988ba2ec2dc`.
- Final encrypted backup was decrypted only in local private memory, restored into an isolated PostgreSQL-compatible engine, and verified by complete order, worker and manual-cache digests. The reviewed migration also passed against this restored snapshot before production DDL.
- Immediately after migration: 385 orders, 385 initial history records, 13 workers, 3 manual classification entries. Every copied order JSON matched its archive entry exactly; mismatch count 0. Worker and manual classification digests matched the final baseline. The archive retained its full JSON and revision.
- `zy_orders_get` returned 385 records, every one carrying a version, with the `rows-v1` protocol. Authenticated and service roles have no direct order write permission; service role has no direct worker write permission.
- The human-save audit ran against the encrypted final read-only snapshot whose complete data was proven identical to the new production rows: rejected 0, forbidden rewrites 0. There were 37 permitted character-form/invisible-control transformations, reported separately and never applied to existing records by this release. Detailed code/field reports remain private.
- Synthetic `check`, `test:human-save`, parser, transport, AI-matching and HTTP static-module regressions passed. Deliberately injecting `validateCompany` into human saving was rejected by the release gate and then removed.
- Existing in-app browser verified exact text after saving/reopening, persistent validation, nonblocking warnings, two-tab same-record conflict/Keep Mine, versioned save/history and restoration against isolated synthetic databases. Native restore confirmation was replaced by explicit in-page confirmation, which was verified successfully with old versions retained.
- GitHub Actions succeeded: [Pages deployment](https://github.com/zhuoyafuwu/zy-labour-system/actions/runs/44650475776) and [recognition regression checks](https://github.com/zhuoyafuwu/zy-labour-system/actions/runs/44650475779).
- Production HTML and all three new JavaScript files returned HTTP 200 and matched the application commit byte-for-byte. The deployed login page loaded in the in-app browser. Unauthenticated function probes returned 401.

## Restored operational state and limits

Maintenance is off. The existing classification schedule is active again with its unchanged `* * * * *` timing. Jobs, task progress and caches were retained; the release created no production test records or model requests, performed no old-order conversion and cleared no data. Profile/match counts remained 1/0 during verification, matching the baseline.

The production verification intentionally did not edit or restore real business records. Behavioral edit/conflict/restore checks used isolated data; production checks were read-only. This release does not establish real-model latency or the 30-second profile / 60-second first-match / 1-second cache targets. Existing AI configuration remains unchanged. Standalone Chrome launch is still constrained by the host; browser acceptance used the existing in-app browser instead.

Users with an already-open old page should refresh before saving. The retired aggregate save RPC refuses stale clients and asks them to preserve inputs and refresh.
