---
id: contributing
title: Contributing
---

# Contributing

Bug reports, fixes, and feature suggestions are welcome. The project is small and the bar is craft over speed.

## Reporting a bug

Open an issue with:

- A short, specific title (`POST /v1/journeys returns 500 when filters.maxTransfers is 0`).
- Steps to reproduce.
- The `X-Request-Id` from the failing response, if you have it — it lets us grep the logs.
- Backend version (`docker compose exec backend ./server --version`).
- Browser, OS, and whether the issue reproduces in a private window (rules out caches and extensions).

Reproducible bugs get fixed faster than vague ones.

## Suggesting a feature

Open an issue first. Describe the user problem you are solving — not the implementation. If the feature passes the "is this in scope?" filter, we'll discuss the design before any code is written.

In-scope:

- Better delay prediction (e.g. integrating ML models on the realtime stream).
- Additional carriers / regions.
- Improved offline UX.
- Improved a11y.

Out-of-scope (for now):

- User accounts.
- Push notifications (we'd need to maintain a notification proxy).
- Ticket booking.
- Anything that requires DB's official API and an API key.

## Submitting a pull request

1. Fork, clone, and create a branch from `master`.
2. Make the change. Follow the conventions in [Development → Workflow](./development/workflow).
3. Run the same checks CI runs locally (see the bottom of [CI/CD](./operations/ci-cd)).
4. Open a PR with a clear title and a body that explains *why*. Screenshots for UI changes.
5. Be patient on review; nudge after a week if there's no movement.

## Pull request checklist

- [ ] Conventional Commits title.
- [ ] Touched files are formatted (`go fmt ./...`, `npm run lint:fix`).
- [ ] Tests added or updated for the change.
- [ ] CI is green.
- [ ] If the OpenAPI spec changed, `types.gen.ts` was regenerated and committed.
- [ ] If a new env var was added, it's documented.
- [ ] No new direct dependencies without a one-line justification in the PR body.

## Coding style

See [Development → Workflow](./development/workflow#code-style) for Go, TypeScript, and SQL conventions.

## Licensing

By contributing you agree your changes are licensed under the project's MIT license.

## Code of conduct

Be kind. Be specific. Assume good faith. If something is unclear, ask. The maintainer's time is finite — make it cheap to merge your PR by anticipating review questions and answering them in the description.
