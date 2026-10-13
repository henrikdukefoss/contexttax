---
name: db-migrate
description: >
  Writes a new Postgres migration for the API, checks it is backwards compatible
  with the deployed code, and adds the matching rollback.
when_to_use: Use when a change needs a new table, column, index or constraint.
---
Steps: create the file in api/migrations, write up and down, run pnpm db:migrate locally.
