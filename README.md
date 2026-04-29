# Nex Books Reservation — Backend

Library book reservation API. **NestJS 11 + GraphQL (Apollo) + Prisma + PostgreSQL**, JWT auth with `USER`/`ADMIN` roles, multi-copy books, and race-safe reservations enforced by a Postgres partial unique index.

Companion frontend: [`nex-books-reservation-front`](../nex-books-reservation-front).

## Quick start (local, Docker)

```bash
docker compose up --build
```

- API → `http://localhost:4000/graphql` (Apollo Sandbox)
- Adminer → `http://localhost:8080` · Server `db`, User `nex`, Pass `nex`, DB `nex_books`
- Postgres exposed on **5433** (avoids collision with other local Postgres on 5432)

Migrations and seeds run automatically on first boot.

## Quick start (without Docker)

```bash
pnpm install
cp .env.example .env                    # adjust DATABASE_URL if needed
pnpm prisma:deploy && pnpm prisma:seed
pnpm start:dev                          # http://localhost:4000/graphql
```

Requires Node 20+ and a running Postgres reachable via `DATABASE_URL`.

## Seed credentials

| Email | Password | Role |
|---|---|---|
| `admin@nex.test` | `Admin123!` | `ADMIN` |
| `ana@nex.test` | `User1234!` | `USER` |
| `bruno@nex.test` | `User1234!` | `USER` |

15 books, ~44 copies, 1 active reservation pre-loaded.

## API — quick tour

GraphQL playground at `/graphql`. Key operations:

```graphql
# Public
query Books { books { id title author availableCopies totalCopies } }

# Auth
mutation Login($i: LoginInput!) {
  login(input: $i) { accessToken user { id email role } }
}

# USER (Authorization: Bearer <token>)
mutation Reserve($i: CreateReservationInput!) {
  createReservation(input: $i) { id status bookCopy { code book { title } } }
}
mutation Return($id: ID!) { returnBook(reservationId: $id) { id status returnedAt } }
query Mine { myReservations { id status bookCopy { book { title } } } }

# ADMIN
mutation NewBook($i: CreateBookInput!) { createBook(input: $i) { id copies { id code } } }
query ResByBook($id: ID!) { reservationsByBook(bookId: $id) { id status reservedAt } }
```

## Business rules — where they live

| Rule | Enforcement |
|---|---|
| R1: reservation requires user, book, dates with `dueDate > now` | `CreateReservationInput` (class-validator) + `ReservationsService.create` |
| R2: at most one active reservation per copy | **DB partial unique index** `reservation_active_per_copy` + service pre-check + retry-on-`P2002` |
| R3: return is allowed before due date | `returnBook` only checks `status=ACTIVE`, never compares dates |
| R4: max 3 active reservations per user | `count(active) < 3` before insert |
| R5: queries support date filters | `from`/`to` args on `myReservations`, `reservationsByBook`, `reservationsByUser` |

See `docs/business-rules.md` for the full mapping with test references.

## Concurrency

The DB partial unique index is the source of truth. On `P2002` the service retries with the next available copy (max 3 attempts).

Verified: `pnpm exec tsx test/concurrency.test.ts` — 10 simultaneous attempts on a single-copy book → exactly 1 succeeds, 9 fail. The proof is reproducible.

## Tests

```bash
DATABASE_URL=postgresql://nex:nex@localhost:5433/nex_books pnpm exec tsx test/concurrency.test.ts
```

Full Jest suite (Testcontainers + Supertest) is sketched in the spec/plan and is the next iteration.

## Deploy (AWS)

ECS Fargate + RDS Postgres + ALB, deployed by GitHub Actions via OIDC. Manual one-time infra setup is documented in [`docs/aws-setup.md`](docs/aws-setup.md). The workflow lives at `.github/workflows/deploy-back.yml`.

## Architecture

- Spec: [`docs/superpowers/specs/2026-04-28-library-reservation-design.md`](docs/superpowers/specs/2026-04-28-library-reservation-design.md)
- Plan (25 tasks, TDD): [`docs/superpowers/plans/2026-04-28-library-reservation.md`](docs/superpowers/plans/2026-04-28-library-reservation.md)

## Explicit v1 trade-offs

Documented as deliberate, with v2 paths:

- **Logout is symbolic** (frontend clears the token). Real revocation needs refresh tokens stored server-side; not in v1.
- **No global throttling.** `@nestjs/throttler`'s default guard reads `req.ip` from REST context and breaks under GraphQL. v2: a `GqlThrottlerGuard` that extracts the request from the GraphQL execution context.
- **No Terraform/CDK.** AWS infra is provisioned manually and documented step-by-step.
- **No Playwright E2E.** `test/concurrency.test.ts` plus the Jest unit suite (per the plan) is the v1 coverage.
