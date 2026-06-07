# CI + Unit Tests Design

**Date:** 2026-06-06
**Goal:** Add a CI pipeline and unit test suite so Dependabot PRs can be merged with confidence.

---

## Problem

Dependabot opens weekly PRs for npm dependency updates. Without CI, there is no automated check to catch breaking API changes or behavioral regressions before merge.

---

## CI Workflow

File: `.github/workflows/ci.yml`

- **Triggers:** push to `main`, pull requests targeting `main`
- **Job:** single job named `ci`
  - Runner: `ubuntu-latest`
  - Node version: 22 (matches Cloudflare Workers target; has native Web Crypto)
  - Dependency install: `npm ci` with npm cache
  - Steps (in order):
    1. `npm run typecheck` — `tsc --noEmit`; catches breaking API-signature changes in deps
    2. `npm test` — vitest; catches behavioral regressions

Typecheck runs before tests so a type error gives a fast, clear failure signal without waiting for the test runner.

---

## Test Stack

- **Runner:** `vitest`
- **Pool:** `@cloudflare/vitest-pool-workers` — runs tests inside a miniflare Workers runtime, providing real Web Crypto and Workers globals (needed by `crypto.ts` via `@bm1549/remote-mcp-cloudflare`)
- **Wrangler binding:** not required for unit tests; pool provides Workers globals without needing KV/DO bindings
- **KV mock:** simple in-memory object (`Map`-backed) implementing `get`, `put`, `delete`; typed as `KVNamespace`
- **fetch mock:** `vi.stubGlobal("fetch", ...)` per test in `validate.test.ts`

Config file: `vitest.config.ts` using `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`.

Test files live alongside source in `src/` (e.g., `src/validate.test.ts`).

New `package.json` script: `"test": "vitest run"`.

New devDependencies: `vitest`, `@cloudflare/vitest-pool-workers`.

---

## Test Coverage

### `src/validate.test.ts`

Tests `validateLunchMoneyToken`. Mocks `fetch` globally per test.

| Scenario | Expected result |
|----------|----------------|
| `fetch` resolves with `ok: true` (200) | `{ ok: true }` |
| `fetch` resolves with 401 | `{ ok: false, status: 401, message: "LunchMoney rejected the token (unauthorized)." }` |
| `fetch` resolves with 403 | same message as 401 |
| `fetch` resolves with 429 | `{ ok: false, status: 429, message: "LunchMoney rate-limited the validation request; try again." }` |
| `fetch` resolves with 500 | `{ ok: false, status: 500, message: "LunchMoney returned 500; try again later." }` |
| `fetch` rejects (network error) | `{ ok: false, status: 0, message: "Network error contacting LunchMoney: ..." }` |

### `src/storage.test.ts`

Tests `getUserToken`, `putUserToken`, `deleteUserToken`. Uses an in-memory KV mock.

| Scenario | Expected result |
|----------|----------------|
| `getUserToken` on missing key | `null` |
| `putUserToken` then `getUserToken` | returns stored value |
| `getUserToken` on invalid JSON | `null` |
| `getUserToken` on JSON missing `token` field | `null` |
| `getUserToken` on JSON missing `email` field | `null` |
| `deleteUserToken` removes the entry | subsequent get returns `null` |
| Key format | stored under `user:<sub>` (test verifies key isolation between two subs) |

### `src/crypto.test.ts`

Tests `signSession`, `verifySession`, `signCsrf`, `verifyCsrf`. Uses real Web Crypto from the Workers runtime.

| Scenario | Expected result |
|----------|----------------|
| `signSession` + `verifySession` round-trip | returns `{ sub, email }` |
| CSRF token rejected by `verifySession` | `null` (wrong `kind`) |
| `signCsrf` + `verifyCsrf` with matching sub | `true` |
| `verifyCsrf` with wrong sub | `false` |
| Session token rejected by `verifyCsrf` | `false` (wrong `kind`) |
| `verifySession` with garbage string | `null` |

### `src/setup.test.ts`

Tests pure helper functions exported from `setup.ts`. No HTTP, no env, no mocks needed.

Functions: `htmlEscape`, `readCookie`, `cspWithNonce`.

> **Note:** These functions are currently unexported. They will need to be exported (or moved to a separate `src/utils.ts` file) for tests to import them. Exporting from `setup.ts` is simpler and preferred.

| Function | Scenarios |
|----------|-----------|
| `htmlEscape` | `&`, `<`, `>`, `"`, `'` each escaped; safe string unchanged |
| `readCookie` | cookie present, cookie absent, multiple cookies (correct one returned), empty cookie header |
| `cspWithNonce` | nonce appears in `script-src`; `default-src 'none'` present |

---

## Out of Scope

- Full `setupHandler` HTTP integration testing (requires mocking `verifyResumeToken`, `resumeAuthorization`, and `signResumeToken` from `@bm1549/remote-mcp-cloudflare` — too much infra for a Dependabot safety-net suite)
- `LunchMoneyMCP` Durable Object
- Worker-level OAuth routing

These are not excluded because they don't matter — they're excluded because the logic they exercise lives in deps, not this repo's code. If deps break those contracts, typecheck will catch the API mismatch.

---

## Success Criteria

- CI passes green on a clean `main` commit
- CI fails if `tsc` reports a type error
- CI fails if any test assertion fails
- Dependabot PRs get CI checks automatically (GitHub requires no extra config beyond the workflow file)
