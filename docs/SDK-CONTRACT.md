# Wealthfolio 3.6.1 SDK / host contract

Findings are verified against the released `v3.6.1` tag of
`wealthfolio/wealthfolio` and the published npm packages unless explicitly
labelled **T09-gate** (must be proven against a disposable 3.6.1 host before
release).

Resolved package versions (after `pnpm install`):

- `@wealthfolio/addon-sdk` resolves to `3.6.1` under the declared `^3.6.0`
  range. The scaffold template declares `sdkVersion: "3.6.0"` and
  `minWealthfolioVersion: "3.6.0"`, so this manifest keeps both at `"3.6.0"`
  to match the scaffold (3.6.1 is an in-range resolution, not a schema bump).
- `@wealthfolio/addon-dev-tools` is `3.6.1`.

## Build / packaging facts

- **Node 20.19+ required.** The scaffold pins `vite@^7.1.5`, which requires
  Node 20.19+ or 22.12+. This repo pins `.nvmrc` to `20.19.0`.
- **Bundle** `papaparse@5.5.4` and `decimal.js@10.6.0`. Do NOT add them to
  `hostDependencies` or to the vite `external` list.
- **Externalize (host-provided ESM):** `@tanstack/react-query`,
  `@wealthfolio/addon-sdk` (+ subpaths), `@wealthfolio/ui`,
  `date-fns`, `lucide-react`, `react`, `react-dom`, `react-dom/client`,
  `react/jsx-runtime`, `react/jsx-dev-runtime`, `recharts`. See `vite.config.ts`.

## Route / sidebar facts (source: `packages/addon-sdk/src/types.ts`)

- **Route:** `ctx.router.add({ id?, path, render })`. The `render` callback
  receives `{ root: HTMLElement, location }`. Create **one** React root with
  `createRoot(routeRoot)`, reuse it across renders, and unmount it in
  `ctx.onDisable()`. (types.ts)
- **Runtime sidebar:** `ctx.sidebar.addItem()` returns a handle with
  `.remove()`; call `.remove()` in `onDisable`. (types.ts)
- **No `contributes`:** the 3.6.1 manifest schema has no `contributes` field,
  and the published route type has no `component` field. (manifest.ts, types.ts)
- **Sidebar icon `files` is valid.** Unknown icon names render a non-fatal
  fallback. (icons.ts)

## Permission facts (source: `packages/addon-sdk/src/permissions.ts`,

## `manifest.json.template`)

- `permissions` is an array of `{ category, functions: string[], purpose }`.
- Each `functions` value is a **bare** function-name string from the category's
  catalog in `permissions.ts` — e.g. `"getAll"`, `"searchTicker"`,
  `"saveMany"`, `"checkImport"`. The `ui` category uses the dotted object forms
  `"sidebar.addItem"`, `"router.add"`, `"navigation.navigate"`, `"onDisable"`.
- The installer normalizes each name into a runtime `FunctionPermission`,
  adding `isDeclared` (from the manifest) and `isDetected` (from static
  analysis). **Never** put `isDeclared` / `isDetected` / `detectedAt` in the
  source manifest — they are runtime-only.
- Declared here: `ui` (`sidebar.addItem`, `router.add`, `onDisable`),
  `accounts` (`getAll`), `activities` (`getAll`, `checkImport`, `saveMany`,
  `getImportMapping`, `saveImportMapping`), `market-data` (`searchTicker`).
- **Not declared:** `query`, `logger`, `toast`, `files`, `secrets`, `network`,
  `settings`. `logger`/`toast` need no permission. `query.getClient()` exists
  but `invalidateQueries`/`refetchQueries` require the `query` permission —
  avoid in v1.

## Activity API facts (source: `host-api.ts`, `data-types.ts`)

- `activities.checkImport(ActivityImport[]): ActivityImport[]` — read-only
  validation gate. Call it before any write.
- `activities.saveMany(ActivityBulkMutationRequest): ActivityBulkMutationResult`
  where the request is `{ creates?, updates?, deleteIds? }` and the result is
  `{ created, updated, deleted, createdMappings, errors }`.
- **Always** call `saveMany({ creates })`. Never pass a bare activity array
  (the bridge treats a bare array as updates). (host-api.ts, data-types.ts)
- `activities.getAll(accountId?)` returns `ActivityDetails[]` which **includes**
  `metadata`. (data-types.ts)

## Metadata / duplicate detection (source: `data-types.ts`)

- `ActivityCreate` has `metadata?: string | Record<string, unknown>` but does
  **not** expose `sourceRecordId`, `idempotencyKey`, or `importRunId`. Those
  exist only on stored `Activity` / `ActivityDetails`. (data-types.ts)
- Therefore duplicate detection **must** ride on `metadata` surviving the
  `saveMany()` → `getAll()` round-trip.
- `getAll()` returning `ActivityDetails[]` (which includes `metadata`) makes
  the round-trip **type-possible**. Whether the host actually **persists**
  `metadata` is **UNVERIFIED** → **T09-gate (mandatory).**
  If metadata does not round-trip, release is blocked or `minWealthfolioVersion`
  is raised deliberately after approval.

## Storage facts (source: `host-api.ts` on `v3.6.1` tag)

- **No durable addon key/value storage on v3.6.1.** `HostAPI` exposes no
  `storage` field. Available surfaces: `secrets` (keyring, permission-gated),
  `settings`, `files` (pickers), `snapshots` (domain). (host-api.ts)
- The `main` branch documents addon storage, but the **released `v3.6.1` tag
  does not expose it.** Do not assume it. **T09-gate** if any storage fallback
  is considered.

## `saveMany` partial/atomic behavior — T09-gate

- Whether `saveMany({ creates })` applies atomically (all-or-nothing) or
  partially (some created, some in `errors`) on the real 3.6.1 host is
  **UNVERIFIED**. The adapter must treat `saveMany` results as authoritative
  and only mark fingerprints imported for entries that appear in `created`.
  **T09-gate.**

## DEGIRO accrued-interest representation — T09-gate

- `Meegekochte Rente` (accrued interest) rows must be represented without a
  cash/cost-basis inconsistency. Whether Wealthfolio 3.6.1 requires the accrued
  amount folded into the BUY `amount`, `fee`, or another field is
  **UNVERIFIED**. **T09-gate.** Until proven, grouped BUY drafts carrying
  accrued interest are blocked from production import.

## Archive limits (source: `crates/core/src/addons/service.rs`)

- The 3.6.1 installer enforces: ≤ 256 entries, ≤ 5 MiB per file, ≤ 25 MiB total
  uncompressed, ≤ 50 MiB compressed. CSS/runtime assets emitted to `dist/` are
  loaded from the archive, so every emitted asset must be packaged.

## T05 adapter implementation status

T05 implemented the Wealthfolio adapter layer (`src/wealthfolio/`) that
consumes the verified facts above. The verified contract facts in this
document are unchanged; this section only records which adapter behaviors
are implemented and which remain **T09-gated**.

Implemented and covered by fake-host unit tests (`tests/wealthfolio/`):

- `convert-activity.ts` is the single runtime boundary importing
  `@wealthfolio/addon-sdk` activity types; decimal strings are preserved.
- Drafts → `ActivityImport[]` (with required `isValid`/`isDraft`) → read-only
  `checkImport` gate → accepted rows → `ActivityCreate[]` →
  `saveMany({ creates })` (never a bare array, never `deleteIds`).
- Duplicate detection via `activities.getAll(accountId)` filtered by
  `metadata.importerId === 'degiro-importer'`; exact-duplicate fingerprints
  are skipped (zero creates on re-import).
- `saveMany` results are authoritative: only fingerprints appearing in
  `created` are marked imported; failed/partial writes never mark failed
  fingerprints.
- Add-on isolation: entries with `importerId: revolut-importer` are ignored.
- Mapping persistence via `getImportMapping`/`saveImportMapping`; saved
  mappings auto-apply only after canonical-identity (symbol+MIC+provider)
  re-verification; ambiguous `searchTicker` blocks; the first result is
  never auto-selected.
- Metadata schema v1 carries only non-sensitive provenance (no raw rows,
  balances, filenames, or paths).

Remaining **T09-gates** (not assumed by T05; must be proven on a disposable
3.6.1 host before release):

- **Metadata round-trip**: whether `saveMany()` → `getAll()` actually persists
  `metadata` on the real host. T05 falls back to positional correlation if
  metadata is absent, but the metadata round-trip is the verified protocol.
- **`saveMany` partial/atomic behavior**: whether the host applies atomically
  or partially. T05 treats `created`/`errors` as authoritative either way.
- **DEGIRO accrued-interest representation**: grouped BUY drafts carrying
  accrued interest remain blocked from production import until the host
  representation is proven.

## T09 disposable-host attempt (blocked)

The exact release archive was SHA-256 validated and installed into a
disposable host using image
`wealthfolio/wealthfolio:3.6.1@sha256:2819715df7057a46a29f30cd3c3e713df3bbe424b3a1bf7f2c92dc1dea1f84a6`.
The host displayed the installed DEGIRO sidebar item, but navigating to
`/addon/degiro-importer` twice failed with the host message:
`Timed out rendering add-on route 'degiro-importer'`.

Consequently, no host activity API behavior, metadata round-trip,
`saveMany` atomicity, duplicate behavior, mapping restart behavior, or
accrued-interest representation was observed. The real-statement parse-only
gate was not run. These remain blocking T09 gates; no release conclusion may
be inferred from the successful installation alone.
