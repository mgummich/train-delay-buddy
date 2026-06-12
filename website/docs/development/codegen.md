---
id: codegen
title: Codegen — OpenAPI → TypeScript
sidebar_position: 3
---

# Codegen — OpenAPI → TypeScript

The frontend's TypeScript types are generated from `backend/openapi.yaml`. The generator is [`openapi-typescript`](https://openapi-ts.dev), invoked via `npm run codegen` in `frontend/`.

## How it works

```
backend/openapi.yaml            (committed)
   │
   │ npm run codegen
   ▼
frontend/src/api/types.gen.ts   (committed)
   │
   ▼
frontend/src/api/client.ts      (uses the generated types via openapi-fetch)
```

`types.gen.ts` is a single file containing every operation, parameter, request body, and response shape from the spec. It is **fully overwritten** on every codegen run. Never edit it by hand — your changes will be lost.

## The two scripts

| Script | What it does |
|--------|--------------|
| `npm run codegen` | Regenerate `types.gen.ts` from `openapi.yaml`. Use after any spec change. |
| `npm run codegen:check` | Regenerate to a temp file and diff against the committed version. Fails non-zero if they differ. This is what CI runs. |

## When to regenerate

Any of these changes to `openapi.yaml` requires a codegen run:

- New endpoint added.
- Existing endpoint signature changed (path, method, params, request/response).
- Schema change (renamed field, type change, new required field).
- New enum value.
- New shared component schema.

A pure documentation tweak (e.g. updating an example string) still works without regen but it's cheap, so just run it anyway.

## Workflow

```bash
# 1. Edit the spec
$EDITOR backend/openapi.yaml

# 2. Regenerate types
cd frontend
npm run codegen

# 3. Verify the generated diff is sane
git diff src/api/types.gen.ts

# 4. Update call sites (TypeScript will tell you what broke)
npm run typecheck

# 5. Commit the spec and the generated file together
git add ../backend/openapi.yaml src/api/types.gen.ts
git commit -m "feat(api): add Idempotency-Key support to POST /v1/journeys"
```

:::warning Keep the spec and the generated file in lockstep
Always commit `openapi.yaml` and `types.gen.ts` in the same commit. Splitting them produces a window where the build is broken on bisect.
:::

## CI enforcement

The `frontend` job in `.github/workflows/ci.yml` runs `npm run codegen:check` before lint and typecheck. The job fails with a clear diff if `types.gen.ts` is out of date.

## Using the typed client

`src/api/client.ts` wraps `openapi-fetch` with:

- `X-Install-Id` injection on every request.
- A custom error mapper that turns RFC 7807 problem responses into typed `ApiError` exceptions.
- Optional `Idempotency-Key` injection on selected mutations.

Calling an endpoint:

```ts
const { data, error } = await client.POST("/v1/journeys", {
  body: {
    trainNumber: "ICE 123",
    destinationId: "8000105",
    filters: { dbOnly: true, safetyLevel: "medium", maxTransfers: 3 },
  },
  headers: {
    "Idempotency-Key": idemKey,
  },
});

if (error) throw new ApiError(error);
// data is fully typed — IDE autocomplete walks the response schema
```

Path strings (`"/v1/journeys"`) are type-safe — the client refuses to compile if you reference an endpoint that does not exist in `types.gen.ts`.

## Runtime validation

Static types describe the *shape* of a response. They do not guarantee the server actually returned that shape. `src/api/validation.ts` defines Zod schemas for every endpoint that flows into UI logic. Each typed hook calls `schema.parse(data)` before returning, which catches:

- A backend regression that shipped without an OpenAPI update.
- A Service Worker serving a corrupted cached payload.
- A reverse proxy stripping a required field.

Failures become `ZodError` exceptions — easily debuggable, single failure mode, surfaced cleanly in the React error boundary.

## Updating the generator

`openapi-typescript` is a versioned devDependency. Bumping it can change generated output (new union forms, narrower types). After a bump:

```bash
cd frontend
npm run codegen
git diff src/api/types.gen.ts   # review the delta
npm run typecheck               # catch breakages
```

If TypeScript yells in many places, you may need adapter changes in `client.ts`.
