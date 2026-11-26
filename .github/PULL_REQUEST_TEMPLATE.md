## What changed

<!-- One paragraph. What behaviour is different after this pull request? -->

## Why

<!-- The problem, the issue number, or the ADR. "Closes #12" if it closes one. -->

## Surface

- [ ] Mini App (`src/`)
- [ ] Collector (`vps/`)
- [ ] Serverless BFF (`tgcloud/`)
- [ ] Docs, ADR, or repository metadata

## Checklist

- [ ] `npm run typecheck` — exit code 0.
- [ ] `npm test` — exit code 0.
- [ ] `npm run test:tgcloud` — exit code 0.
- [ ] New or changed behaviour has a test that would fail without this diff.
- [ ] No bot token, shared secret, `initData`, phone number, real user id, or
      `.env` value in the diff; `gitleaks` was not skipped.
- [ ] An ADR is added or amended if this changes the data model, the ingestion
      method, or the access policy.
- [ ] `README.md`, `AGENTS.md`, or `docs/` updated where the change contradicts
      them.

## Notes for the reviewer

<!-- Known gaps, follow-ups, or a decision you want a second opinion on. -->
