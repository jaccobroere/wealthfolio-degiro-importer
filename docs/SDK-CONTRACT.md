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
