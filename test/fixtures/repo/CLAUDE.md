@AGENTS.md

## Claude Code notes

- Read @docs/architecture.md before changing anything in `api/billing`.
- Money is stored as integer cents. Never use floating point for amounts.
- Dates are stored in UTC and formatted in the user's time zone only in the client.
- Every migration must be backwards compatible with the code that is currently deployed.
- Use `@playwright/test` fixtures from `web/e2e/fixtures.ts`, not ad-hoc page setup.
- Ask before running anything that writes to the staging database.

```sh
# not an import: @docs/never-loaded.md
pnpm test
```

Questions go to team@example.com.
