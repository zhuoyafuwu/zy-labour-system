# AI worker analysis and matching

The current task supersedes classification-only AI ranking: AI builds an evidence-backed worker profile and assigns matching grades. Deterministic rules remain a reference. Gender and age are still strict local/server gates; AI cannot override them.

## Current flow

Saving a worker writes the business record first. A transactional trigger queues occupation units and a separate worker-profile job; a best-effort immediate profile request runs after save without delaying save success. Failure is retried by the existing scheduler, at most six attempts per unchanged inference key. Input changes enqueue a new hash. Profile data is stored in zy_private.ai_worker_profiles, never in business JSON. Match results live in zy_private.ai_match_results; inference leases/attempts and usage have separate private tables.

The profile allowlist contains history position/duties/employer/period, occupational certificates, languages, education, skills/hobbies, three intents, desired salary and the Hong Kong work flag. Known identity/contact/address values are removed even if pasted into an allowed field. Phone/identity/email patterns are redacted again before provider requests. No applicant name, telephone, identity/address, photo or alternate contact field is sent. Literal evidence is validated and directional years cannot exceed stated employment periods. Unknown years are zero.

The match screen defaults to all dates and only release-ready orders, using the same presentation/publication validator in browser and server. Strict gender/age failures are excluded before model input. Unknown demographics remain visibly pending, not invented. Each model batch includes at most thirty eligible job summaries and the profile; up to six browser requests run concurrently. The browser sends record IDs only. Server summaries contain code, title, current classification (manual assignments and merge resolution first), duties, requirements, language and salary. Raw sources and worker identity are never in those summaries.

AI high/mid/low/excluded grades and Chinese evidence-based reasons are primary. Rules remain a reference score. Two-or-more-level disagreement gets a manual-confirmation label. Profile summary and suitable directions appear in the worker panel. Partial batches appear as they complete; failures show rules instead of blocking rendering. Reanalysis is explicit. Interface translation never translates generated business summaries/reasons.

## Caching and concurrency

Profile source hashes use the server-side normalized allowlist. Pair cache keys include worker/profile version, company summary and taxonomy revision. Only missing/changed pairs call the provider. In-memory states are bounded and cleared on login/logout. Server-only 90-second leases prevent concurrent duplicate inference; stale worker hashes cannot commit. Failures retain cached results and bounded retry metadata. No provider/SQL body or credentials are returned in error messages.

## Unlimited usage and automatic classification

New migrations replace the historical 100/20 recognition caps and classification cap. Recognition retains its two-second cooldown and counters; classification reservations count without a cap. New inference usage records profile/match requests; explicit manual profile refresh has a two-second cooldown. There are no app-imposed daily AI call limits. Service/provider limits still surface as failures, never as a fabricated app quota.

The durable classification queue prioritizes histories, then intents, certificates and orders. Three consecutive successful batches double size up to eight. Truncated multi-item batches shrink; singleton failures and valid other responses fail only the affected units without reducing batch size. Leased IDs are persisted so a concurrent new high-priority save cannot change the in-flight batch. Attempts remain bounded at six, and quota-to-midnight waiting is retired. Business saves enqueue changed inputs transactionally; admin full rerun remains available. Manual cache assignments always win.

## Reference rule behavior

Scheme A omits unknown histories while scoring known histories/certificates. A known unrelated major excludes under rules; only unknown jobs or entirely unclassified workers become Manual Judgment. Warehouse aliases include 仓管、仓务、货仓、理货、分拣、冷仓、冻仓 and traditional variants. Main-title text outranks parenthetical supplements. E/F/intent formulas, exact age/gender gates and monetary calculation are unchanged as reference scoring.

## Performance and release boundary

Synthetic tests establish reuse, changed-order-only calls, incremental rendering, concurrency bounds and outage fallback. Thirty-second profile, sixty-second first matching and one-second repeat targets require live provider/network acceptance; no production timing guarantee is claimed from mocks. Existing scheduler retries run at its configured interval; instant retries are not guaranteed.

Read docs/ai-matching-release.md before deployment. No live calls, queue starts, business conversion or deployment are performed during code preparation.
