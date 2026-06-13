---
id: codegen
title: Codegen — OpenAPI → TypeScript
sidebar_position: 3
---

# Codegen — OpenAPI → TypeScript

Frontend types generated from `backend/openapi.yaml` via [`openapi-typescript`](https://openapi-ts.dev) (`npm run codegen` in `frontend/`).

## Flow

```
backend/openapi.yaml            (committed)
   │
   │ npm run codegen
   ▼
frontend/src/api/types.gen.ts   (committed)
   │
   ▼
frontend/src/api/client.ts      (uses generated types via openapi-fetch)
```

`types.gen.ts` is one file with every operation, param, request body, response. **Fully overwritten** each run — never hand-edit.

## Scripts

| Script | What |
|--------|------|
| `npm run codegen` | Regenerate `types.gen.ts`. Use after any spec change. |
| `npm run codegen:check` | Regenerate to temp + diff against committed. Non-zero on diff. CI runs this. |

## When to regenerate

Any of these in `openapi.yaml`:

- New endpoint.
- Endpoint signature change (path, method, params, request/response).
- Schema change (rename, type, new required field).
- New enum value.
- New shared component.

Pure doc tweaks (example strings) work without regen — cheap to run anyway.

## Workflow

```bash
$EDITOR backend/openapi.yaml          # 1. Edit spec
cd frontend && npm run codegen        # 2. Regenerate
git diff src/api/types.gen.ts         # 3. Verify diff
npm run typecheck                     # 4. Update call sites (tsc tells you what broke)
git add ../backend/openapi.yaml src/api/types.gen.ts
git commit -m "feat(api): add Idempotency-Key support to POST /v1/journeys"
```

:::warning Lockstep
Always commit `openapi.yaml` + `types.gen.ts` in the same commit. Splitting produces a broken-build window on bisect.
:::

## CI enforcement

`frontend` job runs `npm run codegen:check` before lint/typecheck. Fails with clear diff if `types.gen.ts` is stale.

## Typed client

`src/api/client.ts` wraps `openapi-fetch` with:

- `X-Install-Id` injection per request.
- Custom error mapper: RFC 7807 problem → typed `ApiError` exceptions.
- Optional `Idempotency-Key` injection on selected mutations.

```ts
const { data, error } = await client.POST("/v1/journeys", {
  body: {
    trainNumber: "ICE 123",
    destinationId: "8000105",
    filters: { dbOnly: true, safetyLevel: "medium", maxTransfers: 3 },
  },
  headers: { "Idempotency-Key": idemKey },
});

if (error) throw new ApiError(error);
// data fully typed — IDE walks the response schema
```

Path strings type-safe — refuses to compile for endpoints not in `types.gen.ts`.

## Runtime validation

Static types describe shape, not what the server actually returned. `src/api/validation.ts` has Zod schemas per UI-bound endpoint. Hooks `schema.parse(data)` before return — catches:

- Backend regression shipped without OpenAPI update.
- SW serving corrupted cache.
- Reverse proxy stripping a required field.

Failures → `ZodError` (single failure mode, debuggable, clean in React error boundary).

## Updating the generator

`openapi-typescript` is a versioned devDep. Bumps can change output (new unions, narrower types):

```bash
cd frontend
npm run codegen
git diff src/api/types.gen.ts   # review delta
npm run typecheck               # catch breakages
```

Many TS errors → adapter changes in `client.ts` may be needed.
