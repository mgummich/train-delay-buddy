---
id: contributing
title: Contributing
---

# Contributing

Bug reports, fixes, feature suggestions welcome. Project is small — bar is craft over speed.

## Reporting a bug

Open an issue with:

- Short, specific title (`POST /v1/journeys returns 500 when filters.maxTransfers is 0`).
- Repro steps.
- `X-Request-Id` from failing response (lets us grep logs).
- Backend version (`docker compose exec backend ./server --version`).
- Browser, OS, whether it repros in a private window (rules out cache + extensions).

Reproducible bugs get fixed faster than vague ones.

## Suggesting a feature

Open an issue first. Describe the **user problem**, not implementation. If in scope, design discussion before any code.

In scope:

- Better delay prediction (e.g. ML on realtime stream).
- Additional carriers / regions.
- Better offline UX.
- Better a11y.

Out of scope (for now):

- User accounts.
- Push notifications (would need notification proxy).
- Ticket booking.
- Anything needing DB's official API + key.

## Pull request

1. Fork, clone, branch from `master`.
2. Make change. Follow [Development → Workflow](./development/workflow).
3. Run CI checks locally (bottom of [CI/CD](./operations/ci-cd)).
4. Open PR — clear title + body explaining *why*. Screenshots for UI.
5. Be patient on review; nudge after a week.

## PR checklist

- [ ] Conventional Commits title.
- [ ] Files formatted (`gofmt -w .`, `npm run lint:fix`) — both are hard CI gates, and `.husky/pre-commit` checks them on staged files.
- [ ] Tests added / updated.
- [ ] CI green.
- [ ] OpenAPI changed → `types.gen.ts` regenerated + committed.
- [ ] New env var → documented.
- [ ] No new direct deps without one-line justification.

## Style

See [Development → Workflow](./development/workflow#code-style) for Go, TS, SQL conventions.

## Licensing

By contributing, you agree changes are licensed under the project's MIT license.

## Code of conduct

Be kind. Be specific. Assume good faith. Make it cheap to merge your PR by anticipating review questions and answering them in the description.
