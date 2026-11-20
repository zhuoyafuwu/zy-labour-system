# Shared interface system

Reference: https://claude.ai/artifact/AuxH9EZ6sDTMMwkgLCmE49 (source baseline main@57c5884).

The checked-in design token file is authoritative. Use its system Chinese font stack, palette, type scale, 4/8/12/16/20/24 spacing, 8/12/pill radii, accessible control borders, status colors plus text, and 639/1099 breakpoints. The source component bundle was readable; its live previews were unavailable because bundle.js was absent. Components are implemented with the current native HTML/JavaScript stack.

## Components and local extensions (defined before implementation)

- Button, StatusChip, Field, Notice, OrderRow, CompanySlip and MatchLevel follow the supplied bundle. CompanySlip is the only decorated surface; display and clipboard share the existing publication text. User-edited fee notes remain authoritative.
- Navigation: full 208px sidebar at desktop, 64px icon rail at medium widths, existing three-item bottom navigation on phones. Settings and classification are reached through settings, without adding phone navigation items.
- Dialog: tokenized panel and overlay, bounded viewport height, visible close controls; Escape/outside interaction dispatches the existing cancel handler so unresolved conflict input remains protected. No native confirmations are added.
- Settings: account, team, classification and backups are separate panels. Switching panels keeps form nodes and input values. Administrative panels remain role-gated and existing server authorization is unchanged.
- WorkerForm/History: existing fields and persistence keys, full-width multiline duties, no automatic field correction or record writes. Physical A4 export coordinates, source-PDF geometry and raster colors are intentionally exempt from screen layout token conversion.
- WorkerPicker: stable selected label, clear action, total count, Escape/outside close and arrow navigation. No AI calls are made by the directory itself.
- ErrorNotice: persistent inline alert with a dismiss action, preserving entered form data. Success notifications may disappear. Recognition warnings are yellow and never become additional save blockers.

## Responsive contract

At 1100px and above, desktop lists use fixed-height single-line cells, with at least ten Chinese characters of title space and visible state/match, job, salary and copy action. At 640–1099px use compact cards and the icon rail; details open as a drawer. At 639px and below retain the existing bottom navigation and use cards plus a bottom detail drawer. Each card line truncates independently; no field wraps into a second line. Descriptive detail and history text may wrap.

CSS variables cannot be used in standard media-query conditions. Breakpoint literals match design-tokens.json and are checked in the UI regression. Physical template dimensions and data-driven percentages are not screen design tokens. Legacy structural dimensions are retained where layout-specific; semantic typography and spacing take precedence for shared components.

## Validation

Use the existing in-app browser with synthetic data at 1280px, 690px and 375px. Check form state preservation, admin/member settings, picker, matching reasons, copy text and drawers. Keep business dates in Asia/Shanghai, manual-save rules, gender/age gates, price suggestion and fee-note behavior unchanged. No production records, backfill or AI calls are needed.

## Verification and release boundary

Run `node scripts/design-tokens.mjs` after editing tokens, then `npm run check` and `npm run test:ui`. Both website workflows run the shared-interface regression. The self-hosted server explicitly serves every new shared asset; its test checks exact bytes and MIME types.

This release contains frontend assets plus the self-hosted static allowlist. It needs no Supabase migration, Edge deployment, task restart, quota change or AI invocation. Publish the reviewed commit through the existing Pages workflow only after user confirmation. The complete change is based on main@57c5884 and preserves the earlier unpublished work branch.
