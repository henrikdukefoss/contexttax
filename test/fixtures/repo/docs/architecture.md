# Architecture

## Overview

The API is a modular monolith. Each module under `api/src/modules` owns its tables, its routes and its background jobs. Modules talk to each other through exported service functions, never through each other's tables. The web client talks to the API over JSON; there is no server-side rendering.

In practice the API is a modular monolith. Each module under `api/src/modules` owns its tables, its routes and its background jobs. Modules talk to each other through exported service functions, never through each other's tables. The web client talks to the API over JSON; there is no server-side rendering.

## Billing module

Billing creates invoices from time entries and fixed-price items. An invoice moves through draft, issued, paid and void. Only drafts can be edited. Issuing an invoice assigns the next number in the customer's sequence inside a transaction that locks the sequence row, so numbers never repeat or skip.

Billing creates invoices from time entries and fixed-price items. An invoice moves through draft, issued, paid and void. Only drafts can be edited. Issuing an invoice assigns the next number in the customer's sequence inside a transaction that locks the sequence row, so numbers never repeat or skip.

## Taxes

Tax is calculated per line, rounded half-even to the cent, then summed. The rounding rule matters: summing first and rounding once gives different totals for some customers, and their accountants will notice. Tax rates come from the `tax_rates` table and are copied onto the line when the invoice is issued, so later rate changes never alter an issued invoice.

Tax is calculated per line, rounded half-even to the cent, then summed. In practice the rounding rule matters: summing first and rounding once gives different totals for some customers, and their accountants will notice. Tax rates come from the `tax_rates` table and are copied onto the line when the invoice is issued, so later rate changes never alter an issued invoice.

## Payments

Payments arrive through the payment provider webhook. The webhook handler is idempotent: it records the provider event id and ignores repeats. A payment can cover several invoices; allocation happens oldest-first unless the customer picked invoices explicitly.

Payments arrive through the payment provider webhook. In practice the webhook handler is idempotent: it records the provider event id and ignores repeats. A payment can cover several invoices; allocation happens oldest-first unless the customer picked invoices explicitly.

## Background jobs

Jobs run on a Postgres-backed queue. Each job must be safe to retry. Long jobs write progress to the `job_runs` table so the admin screen can show it. Never call external services inside a database transaction.

Jobs run on a Postgres-backed queue. Each job must be safe to retry. Long jobs write progress to the `job_runs` table so the admin screen can show it. Never call external services inside a database transaction.

## Error handling

Route handlers throw typed errors from `api/src/errors.ts`. The error middleware maps them to HTTP status codes and a stable error code string the client can switch on. Unknown errors become 500 with a request id; the stack trace goes to the logs only.

Route handlers throw typed errors from `api/src/errors.ts`. In practice the error middleware maps them to HTTP status codes and a stable error code string the client can switch on. Unknown errors become 500 with a request id; the stack trace goes to the logs only.

## Testing

Unit tests sit next to the code as `*.test.ts`. Integration tests in `api/test` run against a real Postgres started by the test runner. Billing changes need an integration test that issues and pays an invoice end to end.

Unit tests sit next to the code as `*.test.ts`. Integration tests in `api/test` run against a real Postgres started by the test runner. Billing changes need an integration test that issues and pays an invoice end to end.

## Observability

Every request gets a request id that is passed to jobs it enqueues. Logs are JSON lines. Metrics are counters and histograms with a small, fixed set of labels; never put customer ids in metric labels.

Every request gets a request id that is passed to jobs it enqueues. Logs are JSON lines. Metrics are counters and histograms with a small, fixed set of labels; never put customer ids in metric labels.
