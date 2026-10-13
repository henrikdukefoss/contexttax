# Sample App

A small invoicing web app: a TypeScript API in `api/` and a React client in `web/`.

## Commands

- Install: `pnpm install`
- Dev server: `pnpm dev` (API on :4000, web on :5173)
- Tests: `pnpm test` for unit tests, `pnpm test:e2e` for the browser suite
- Lint and types: `pnpm lint && pnpm typecheck` before every commit

## Code style

- TypeScript strict mode everywhere. No `any` without a comment saying why.
- Prefer small pure functions. Keep side effects at the edges (route handlers, jobs).
- Money is stored as integer cents. Never use floating point for amounts.
- Dates are stored in UTC and formatted in the user's time zone only in the client.
- Name files after the thing they export: `invoice-total.ts` exports `invoiceTotal`.

## Database

- Postgres 16. Migrations live in `api/migrations` and are applied with `pnpm db:migrate`.
- Every migration must be backwards compatible with the code that is currently deployed.
- Add an index for every foreign key you create.

## Pull requests

- One topic per pull request. Keep unrelated refactors out.
- Describe how you tested the change. Screenshots for UI work.
- CI must be green before review. Do not disable failing tests to get there.

## Things to avoid

- Do not commit `.env` files or anything from `secrets/`.
- Do not add new dependencies without asking first.
- Do not change the public API response shapes without a version bump.
