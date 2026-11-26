# Теле-Лента — working agreement

A Telegram Mini App that turns classifieds, jobs, and event posts from public
Montenegrin and Serbian Telegram chats into one de-duplicated feed. Every card
keeps a link back to its source message; contact happens in the source chat.

This file is the contract for anyone — human or agent — changing this repository.

## Three runtimes

| Runtime | Path | Stack | Rule |
| --- | --- | --- | --- |
| Mini App | `src/` | Preact, TypeScript, Tailwind v4, Vitest | Pure model modules (`*-model.ts`, `state.ts`) carry the logic and their tests; components stay thin. |
| Serverless BFF | `tgcloud/` | plain JavaScript ESM on Telegram Serverless | No npm at runtime, no filesystem, no long-running process. |
| Collector | `vps/` | Node 22, TypeScript, Fastify 5, `better-sqlite3` | All SQL lives in `vps/src/store/`; no ORM; migrations are hand-written SQL. |

## Platform facts (verified, not preferences)

- `tgcloud/` imports only `sdk`, `sdk/*`, and relative `.js` modules. No npm
  packages, no `node:*`, no filesystem.
- Serverless handlers and endpoints are flat files; endpoints are callable only
  from the Mini App with platform-verified `initData`, and return JSON only.
- The platform SQLite has foreign keys **off**; `.references()` throws.
- Serverless has no cron: it runs on an update or a Mini App call. Anything
  periodic belongs to the collector tick.
- Deploy and migrate are separate: `npx tgcloud push`, `npx tgcloud migrate`.

## Commands

Nothing else is part of the contract. If you add a command, add it here.

```bash
npm ci                  # install (Mini App + vps workspace)
npm run typecheck       # tsc for the app and the vps workspace
npm test                # Vitest app suite + vps node:test suite
npm run test:tgcloud    # Serverless BFF unit tests
npm run build           # production build of the Mini App
npm run dev             # Vite dev server

npm -w vps run migrate  # apply numbered SQL migrations
npm -w vps run tick     # one collector tick (cron calls this every minute)
npm -w vps run backfill -- @username
npm -w vps run admin -- list
```

## Definition of Done

A change is done only when all four hold, in this order:

1. `npm run typecheck` → exit 0.
2. `npm test` and `npm run test:tgcloud` → exit 0.
3. `gitleaks detect --no-banner` → no leaks (the pre-commit hook runs it too).
4. An ADR exists in `docs/adr/` if the change touches the data model, the
   ingestion method, or the access policy.

Run a gate as `cmd > log 2>&1; echo "EXIT=$?"`. Never read `$?` after a pipe.

## Boundaries

### ALWAYS

- Read the ADR that covers the area before changing it, and `GLOSSARY.md` before
  naming anything: the domain words are Russian, and near-synonyms are mistakes
  (`Объявление` ≠ `Карточка`, `Кластер` ≠ `Дубль`).
- Put new behaviour behind a test that fails without the change. Pure modules
  get unit tests; store changes get a test against a temporary SQLite file.
- Keep the collector polite: honour the per-source budget, one request per
  second per source, and the descriptive `User-Agent`.
- Keep `docs/`, `README.md`, and this file true when a change contradicts them.
- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

### ASK FIRST

- Changing the data model, the ingestion method, or the source-access policy —
  each is an ADR-level decision.
- Adding a runtime dependency, or anything to `tgcloud/` that is not `sdk`.
- Editing a migration that has already shipped (the answer is normally a new
  numbered file).
- Changing a default in `vps/src/config.ts` that affects request volume.
- Relicensing, or changing the copyright holder.

### NEVER

- Commit `.env`, `.tgcloud/`, a bot token, the shared secret, `initData`, a real
  user id, or a phone number. Never log `initData` either.
- Add a userbot / MTProto account scraper, or put a bot into a source chat. The
  collector reads public embed pages only.
- Return binary from a Serverless endpoint.
- Turn on foreign keys in the platform SQLite schema.
- Remove the `gitleaks` hook, or bypass it for one commit.
- Edit files in `node_modules/`, `dist/`, or a generated bundle.

## Where to look

```
docs/adr/           decisions that are expensive to reverse — read first
docs/design/        the UI direction, screen map, theme contract
docs/research/      cited notes behind the ingestion and UI decisions
GLOSSARY.md         domain vocabulary
CONTRIBUTING.md     the human-facing version of this file
vps/README.md       collector internals, environment table, deploy order
tgcloud/README.md   BFF contract and platform constraints
```

## Rhythm

One ticket per session: read the issue, write the failing test, make it pass,
run the gates, open the pull request. Commit at 60 steps; hand off in writing
before 100. Anything you notice on the way is a new issue, not a wider diff.
