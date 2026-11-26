# Contributing

Thanks for taking this on. The project is small but has three runtimes, so the
first ten minutes matter: read this page, then `README.md`, then the ADR that
covers the area you are touching.

## Set up

Node 22 or newer, npm 10 or newer. No database server, no Python, no service to
run before the tests pass.

```bash
git clone https://github.com/ValDagon/tele-lenta.git
cd tele-lenta
npm ci
```

`npm ci` also installs the `vps` workspace. `better-sqlite3` compiles a native
module; if it fails, install build tools for your platform and re-run.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Mini App unit tests (Vitest) and the VPS suite (`node --test`) |
| `npm run test:tgcloud` | Serverless BFF unit tests |
| `npm run typecheck` | TypeScript for the Mini App and the VPS workspace |
| `npm run build` | Production build of the Mini App |
| `npm run dev` | Vite dev server for the Mini App |
| `npm -w vps run migrate` | Apply the SQL migrations to a local SQLite file |
| `npm -w vps run tick` | One collector tick against the configured sources |
| `npm -w vps run backfill -- @username` | Manual first ingest of one source |

Every command in that table is what CI runs. If a command is missing here, it is
not part of the contract.

## Where things live

- `src/` — the Mini App (Preact, no router library, pure model modules with
  their tests next to them).
- `tgcloud/` — the Telegram Serverless bot handler and BFF. Plain JavaScript
  ESM, no npm packages at runtime.
- `vps/` — the collector: Fastify API, SQLite store, parser, ingest, digests.
- `docs/adr/` — decisions that are expensive to reverse. Read the one that
  covers your change before you write code.
- `GLOSSARY.md` — the domain words. Use them in code, tests, and copy.

## Before you open a pull request

1. `npm run typecheck && npm test && npm run test:tgcloud` — all green.
2. A test for the behaviour you changed. Pure modules get unit tests; store
   changes get a test against a temporary SQLite file.
3. No real token, `initData`, phone number, or `.env` value in the diff. The
   pre-commit hook runs `gitleaks`; do not skip it.
4. A commit message in the Conventional Commits style (`feat:`, `fix:`,
   `docs:`, `refactor:`, `test:`, `chore:`), one logical change per commit.
5. If the change alters a data model, the ingestion method, or the access
   policy, add or amend an ADR in `docs/adr/` in the same pull request. A
   message that says "as discussed" is not a decision record.

## Good first issues

Issues labelled `good first issue` are scoped so one person can finish them
without asking questions. Issues labelled `ready-for-agent` are written for an
autonomous coding agent: exact files, exact acceptance criteria.

## Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Report unacceptable behaviour through the private channel described there, not
in a public issue.

## License

Contributions are accepted under the Apache License 2.0. By opening a pull
request you confirm you have the right to license the code that way.
