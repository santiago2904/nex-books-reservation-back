# Nex Books Reservation — Backend Design Spec

**Date:** 2026-04-28
**Repo:** `nex-books-reservation-back`
**Status:** Approved (awaiting implementation plan)

This document is the source of truth for the backend implementation. The companion frontend spec lives in `nex-books-reservation-front/docs/superpowers/specs/2026-04-28-library-reservation-design.md`.

---

## 1. Goal & scope

Build a library book reservation API for the Nex assessment with:

- User registration + JWT login, two roles (`USER`, `ADMIN`).
- Books catalog with **multiple physical copies** per title.
- Reservations with the 5 business rules below, race-condition safe.
- Production-grade deployment to AWS (ECR + ECS Fargate + RDS Postgres + ALB) via GitHub Actions OIDC.

Out of scope (v1, documented in README): refresh tokens / server-side logout revocation, Terraform/CDK, Playwright E2E, multi-tenant.

## 2. Stack

- **Runtime:** Node 20, NestJS 10, TypeScript 5
- **API:** GraphQL (Apollo Server v4 via `@nestjs/graphql`, code-first)
- **ORM:** Prisma 5
- **DB:** PostgreSQL 16
- **Auth:** `@nestjs/jwt` + Passport JWT, bcrypt (12 rounds)
- **Validation:** `class-validator` on DTOs
- **Tests:** Jest + Supertest + Testcontainers (real Postgres)
- **Container:** Docker multi-stage, `node:20-alpine`, `dumb-init`
- **Infra:** ECS Fargate, RDS Postgres, ALB, ACM, Secrets Manager, ECR, CloudWatch Logs

## 3. Domain model (Prisma)

```prisma
enum Role         { USER  ADMIN }
enum ResStatus    { ACTIVE  RETURNED }
enum CopyStatus   { AVAILABLE  RESERVED  MAINTENANCE }

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(USER)
  createdAt    DateTime @default(now())
  reservations Reservation[]
}

model Book {
  id          String     @id @default(uuid())
  title       String
  author      String
  isbn        String?    @unique
  description String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  copies      BookCopy[]
}

model BookCopy {
  id        String     @id @default(uuid())
  bookId    String
  book      Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  code      String     @unique           // e.g. "9780307474728-001"
  status    CopyStatus @default(AVAILABLE)
  createdAt DateTime   @default(now())
  reservations Reservation[]
  @@index([bookId, status])
}

model Reservation {
  id             String     @id @default(uuid())
  userId         String
  user           User       @relation(fields: [userId], references: [id])
  bookCopyId     String
  bookCopy       BookCopy   @relation(fields: [bookCopyId], references: [id])
  reservedAt     DateTime   @default(now())
  dueDate        DateTime
  returnedAt     DateTime?
  status         ResStatus  @default(ACTIVE)
  idempotencyKey String?
  createdAt      DateTime   @default(now())

  @@unique([userId, idempotencyKey])
  @@index([bookCopyId, status])
  @@index([userId, status])
  @@index([reservedAt])
}
```

**Critical DB-level constraint** (added via raw migration since Prisma doesn't support partial unique indexes natively):

```sql
CREATE UNIQUE INDEX reservation_active_per_copy
  ON "Reservation" ("bookCopyId")
  WHERE status = 'ACTIVE';
```

This makes "one active reservation per copy" *physically impossible* under any concurrency.

## 4. Business rules (R1–R5)

| # | Rule | Where enforced |
|---|------|----------------|
| R1 | Reservation requires user, book, reservedAt, dueDate; `dueDate > reservedAt` | DTO (class-validator) + service |
| R2 | A copy cannot have more than one active reservation | DB partial unique index + service pre-check |
| R3 | A book may be returned before dueDate | Service: `returnBook` only checks `status=ACTIVE`, never compares dates |
| R4 | A user may have at most 3 active reservations simultaneously | Service: `count(active) < 3` before insert |
| R5 | Reservation queries by book and by user must support date filters | Resolver args `from`, `to` (`reservedAt BETWEEN`) |

## 5. Module structure

```
src/
├── main.ts                       # bootstrap, CORS, GraphQL playground (dev)
├── app.module.ts
├── prisma/
│   ├── prisma.module.ts          # @Global
│   ├── prisma.service.ts         # extends PrismaClient, onModuleInit/Destroy
│   └── schema.prisma
├── auth/
│   ├── auth.module.ts
│   ├── auth.service.ts           # validateUser, login, register, hashPassword
│   ├── auth.resolver.ts
│   ├── jwt.strategy.ts
│   ├── guards/
│   │   ├── gql-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── public.decorator.ts
│   └── dto/{ register.input.ts, login.input.ts, auth-payload.output.ts }
├── users/
│   ├── users.module.ts
│   ├── users.service.ts          # createUser (admin), findById, findByEmail
│   ├── users.resolver.ts
│   └── dto/{ create-user.input.ts, user.output.ts }
├── books/
│   ├── books.module.ts
│   ├── books.service.ts          # CRUD + computed availableCopies
│   ├── book-copies.service.ts    # add/remove copies, status transitions
│   ├── books.resolver.ts
│   └── dto/{ create-book.input.ts, update-book.input.ts, book.output.ts, book-copy.output.ts }
├── reservations/
│   ├── reservations.module.ts
│   ├── reservations.service.ts   # core logic
│   ├── reservations.resolver.ts
│   └── dto/{ create-reservation.input.ts, reservation-filters.input.ts, reservation.output.ts }
└── common/
    ├── filters/prisma-exception.filter.ts   # P2002 → ConflictException, P2025 → NotFoundException
    ├── pipes/                                # zod or class-validator pipe
    └── interceptors/                         # logging
```

`APP_GUARD` registers `GqlAuthGuard` globally; `@Public()` exposes specific resolvers (register, login, books query).

## 6. GraphQL schema (code-first contract)

```graphql
# Types
type User       { id: ID!, name: String!, email: String!, role: Role!, createdAt: DateTime! }
type Book       { id: ID!, title: String!, author: String!, isbn: String, description: String,
                  totalCopies: Int!, availableCopies: Int!, copies: [BookCopy!]!,
                  createdAt: DateTime!, updatedAt: DateTime! }
type BookCopy   { id: ID!, code: String!, status: CopyStatus!, book: Book! }
type Reservation{ id: ID!, user: User!, bookCopy: BookCopy!, reservedAt: DateTime!,
                  dueDate: DateTime!, returnedAt: DateTime, status: ResStatus! }
type AuthPayload{ accessToken: String!, user: User! }

enum Role        { USER  ADMIN }
enum ResStatus   { ACTIVE  RETURNED }
enum CopyStatus  { AVAILABLE  RESERVED  MAINTENANCE }

# Queries
type Query {
  books(available: Boolean): [Book!]!                        # public
  book(id: ID!): Book                                        # public
  me: User!                                                  # auth
  myReservations(from: DateTime, to: DateTime,
                 status: ResStatus): [Reservation!]!         # auth
  reservationsByBook(bookId: ID!, from: DateTime,
                     to: DateTime): [Reservation!]!          # admin
  reservationsByUser(userId: ID!, from: DateTime,
                     to: DateTime): [Reservation!]!          # admin
}

# Mutations
type Mutation {
  register(input: RegisterInput!): AuthPayload!              # public
  login(input: LoginInput!): AuthPayload!                    # public
  createUser(input: CreateUserInput!): User!                 # admin
  createBook(input: CreateBookInput!): Book!                 # admin (incl. initialCopies: Int)
  updateBook(id: ID!, input: UpdateBookInput!): Book!        # admin
  deleteBook(id: ID!): Boolean!                              # admin (rejects if active reservations)
  addBookCopy(bookId: ID!): BookCopy!                        # admin
  removeBookCopy(copyId: ID!): Boolean!                      # admin (only if AVAILABLE)
  createReservation(input: CreateReservationInput!): Reservation!  # USER
  returnBook(reservationId: ID!): Reservation!               # owner or ADMIN
}
```

Inputs:
- `CreateBookInput { title, author, isbn?, description?, initialCopies: Int }` (initialCopies ≥ 1)
- `UpdateBookInput { title?, author?, isbn?, description? }` (no copies management — use addBookCopy/removeBookCopy)
- `CreateReservationInput { bookId: ID!, dueDate: DateTime!, idempotencyKey?: String }`

## 7. Auth flow

- **Tokens:** access JWT only, HS256, exp **1h**, payload `{ sub, role, jti }`. Header `Authorization: Bearer <token>`.
- **Logout:** symbolic (frontend clears token + Apollo cache). Documented as v1 trade-off; v2 path = refresh tokens in DB.
- **Password:** bcrypt 12 rounds. Min 8 chars, must contain letter and digit (Zod / class-validator).
- **`@CurrentUser()`** decorator reads `request.user` set by `JwtStrategy.validate`.
- **`@Roles('ADMIN')`** + `RolesGuard` reflector check.

## 8. Reservation creation flow (the critical path)

```
1. Guard: GqlAuthGuard
2. Validate input (DTO): bookId UUID, dueDate > now, dueDate ≤ now+90d
3. If idempotencyKey present:
     - Look up Reservation WHERE userId=X AND idempotencyKey=Y
     - If found, return it (idempotent re-execution)
4. count(Reservation WHERE userId=X AND status=ACTIVE)
     - If >= 3, throw BadRequestException(code='MAX_ACTIVE_RESERVATIONS')
5. attempts = 0
   while attempts < 3:
     copy = findFirst(BookCopy WHERE bookId=X AND status=AVAILABLE)
     if not copy: throw BadRequestException(code='NO_COPIES_AVAILABLE')
     try:
       prisma.$transaction([
         createReservation({status: ACTIVE, bookCopyId: copy.id, idempotencyKey, ...}),
         updateBookCopy({where: {id: copy.id, status: AVAILABLE}, data: {status: RESERVED}})
       ])
       return reservation
     catch P2002 (partial unique index violation → another tx beat us):
       attempts++; continue
   throw ConflictException(code='RACE_RETRY_EXHAUSTED')   // extremely unlikely
```

## 9. Return flow

```
1. Guard: GqlAuthGuard
2. Find reservation by id; throw NotFoundException if missing
3. Authorize: requester is reservation.userId OR has role ADMIN; else ForbiddenException
4. If status != ACTIVE, throw BadRequestException(code='RESERVATION_NOT_ACTIVE')
5. prisma.$transaction([
     updateReservation({id}, {status: RETURNED, returnedAt: now()}),
     updateBookCopy({id: reservation.bookCopyId}, {status: AVAILABLE})
   ])
6. Return updated reservation
```

## 10. Errors & error codes

`PrismaExceptionFilter` maps:
- `P2002` → `409 ConflictException` with `extensions.code = 'RESOURCE_CONFLICT'`
- `P2025` → `404 NotFoundException` with `extensions.code = 'NOT_FOUND'`

Domain error codes (returned in `errors[].extensions.code`):
- `MAX_ACTIVE_RESERVATIONS` (R4)
- `NO_COPIES_AVAILABLE` (R2)
- `RESERVATION_NOT_ACTIVE` (return guard)
- `BOOK_HAS_ACTIVE_RESERVATIONS` (delete book)
- `COPY_NOT_AVAILABLE` (remove copy when not AVAILABLE)
- `INVALID_CREDENTIALS` (login)
- `EMAIL_ALREADY_EXISTS` (register)

Frontend maps these to Spanish user-facing messages.

## 11. Testing strategy

```
test/
├── unit/
│   ├── reservations.service.spec.ts      # 8 tests covering R1-R5 + idempotency
│   ├── auth.service.spec.ts              # hashing, validate, token issue
│   └── books.service.spec.ts             # add/remove copies, delete with active reservations
├── integration/
│   ├── reservation-flow.e2e-spec.ts      # register → reserve → return via GraphQL
│   ├── auth-flow.e2e-spec.ts             # register → login → access protected query
│   └── concurrency.e2e-spec.ts           # 10 parallel reservations for last copy → 1 wins
└── helpers/
    ├── test-app.ts                       # Testcontainers Postgres + NestJS bootstrap
    ├── db-cleanup.ts
    └── factories.ts
```

**Required tests** (cover all 5 business rules + concurrency + idempotency):

1. `creates reservation with valid input` (R1)
2. `rejects reservation when no copies available` (R2)
3. `rejects 4th active reservation per user` (R4)
4. `rejects dueDate ≤ reservedAt` (R1)
5. `returnBook before dueDate succeeds` (R3)
6. `returnBook by non-owner USER fails` (authorization)
7. `returnBook by ADMIN succeeds for any user` (authorization)
8. `concurrent createReservation for last copy → only 1 succeeds`
9. `idempotent createReservation with same key returns same reservation`
10. `reservationsByBook filters by date range` (R5)
11. `reservationsByUser filters by date range` (R5)

**Coverage targets:** 80% global, **100% on `reservations.service.ts`**.

CI pipeline runs: `lint && typecheck && test:unit && test:integration`.

## 12. Seeders

`prisma/seed.ts`:
- 1 admin: `admin@nex.test` / `Admin123!`
- 2 users: `ana@nex.test`, `bruno@nex.test` / `User1234!`
- 15 books with 1–4 copies each (~44 copies total)
- 3 active reservations to populate dashboards on first login

## 13. Docker & local dev

`docker-compose.yml` services: `db` (Postgres 16-alpine), `api` (this app), `adminer` (8080).

API container command: `pnpm prisma migrate deploy && pnpm prisma db seed && pnpm start:dev`. Single `docker-compose up` boots a fully working environment.

`Dockerfile` is multi-stage (deps → build → runtime), `node:20-alpine` base, runs as non-root `node` user, uses `dumb-init` for proper SIGTERM handling.

## 14. Configuration / env vars

| Key | Local default | Prod source |
|-----|---------------|-------------|
| `DATABASE_URL` | `postgresql://nex:nex@db:5432/nex_books` | Secrets Manager `nex/prod/db` |
| `JWT_SECRET` | `dev-secret-do-not-use-in-prod` | Secrets Manager `nex/prod/jwt` (32 bytes random) |
| `JWT_EXPIRES_IN` | `1h` | `1h` |
| `PORT` | `4000` | `4000` |
| `CORS_ORIGIN` | `http://localhost:5173` | `https://<vercel-domain>,https://<custom-domain>` |
| `NODE_ENV` | `development` | `production` |

Validated at boot with a Zod schema in `src/config/env.ts`. Boot fails fast on missing/invalid env.

## 15. AWS infrastructure

Provisioned manually via `aws` CLI / console; documented step by step in `docs/aws-setup.md`. No Terraform in v1.

| Resource | Spec |
|----------|------|
| RDS | `db.t4g.micro`, 20GB gp3, Postgres 16, private subnets, SG = ECS only |
| Secrets Manager | `nex/prod/db` (full URL), `nex/prod/jwt` (32 bytes) |
| ECR | `nex-books-back` |
| ECS Cluster | `nex-cluster` (Fargate) |
| Task Definition | 0.25 vCPU, 0.5GB RAM, secrets injected, health check `GET /health`, logs to `/ecs/nex-books-back` |
| ECS Service | desired=1, ALB-attached, rolling deploy 100/200 |
| ALB | public, 443 with ACM cert, 80→443 redirect |
| Migrations | one-off Fargate task triggered by GHA before service update |
| CloudWatch alarms | 5xx > 1%, CPU > 80% |

## 16. CI/CD (GitHub Actions)

`.github/workflows/deploy-back.yml`:

- **Trigger:** push to `main` modifying `src/**`, `prisma/**`, `Dockerfile`, `package.json`, `pnpm-lock.yaml`.
- **Job `test`:** services Postgres, runs lint + typecheck + unit + integration.
- **Job `deploy` (needs test):**
  - OIDC role assume (no long-lived AWS keys)
  - ECR login, build, tag with `${{ github.sha }}` and `latest`, push
  - Run migrations as one-off Fargate task; wait; check exit code
  - `aws-actions/amazon-ecs-deploy-task-definition` with `wait-for-service-stability: true`

Trust policy on `gh-actions-deploy` IAM role limits to OIDC `repo:<org>/nex-books-reservation-back:ref:refs/heads/main`.

## 17. Observability

- All requests logged with request id, user id, op name (Nest interceptor → CloudWatch).
- Error filter logs full stack on 5xx, sanitized message on 4xx.
- Health endpoints: `/health` (liveness), `/health/ready` (DB ping for readiness).

## 18. Security checklist

- bcrypt 12 rounds for passwords
- JWT secret ≥ 32 bytes from Secrets Manager
- CORS strictly to known origins
- No request logging of `Authorization` header or password fields
- Prisma parameterized queries everywhere (no raw SQL except the partial index migration)
- Rate limit on `login` and `register` (10/min per IP) via `@nestjs/throttler` (cheap, worth it)
- HTTPS-only via ALB + ACM
- RDS in private subnets, only reachable from ECS SG

## 19. Estimated effort

| Phase | Hours |
|-------|-------|
| Bootstrap + Prisma schema + migrations | 3–4 |
| Auth module + JWT + guards | 4–5 |
| Books + BookCopies CRUD | 3–4 |
| Reservations service + race handling | 5–6 |
| Resolvers + DTOs + error filter | 3 |
| Tests (unit + integration + concurrency) | 5–7 |
| Docker + seeders | 2 |
| AWS infra (RDS, ECS, ALB, ACM, Secrets) | 3–4 |
| GitHub Actions + OIDC role | 2 |
| README + AWS docs | 2 |
| **Total** | **32–40h** |

## 20. Open items / explicit non-goals

- No refresh tokens, no server-side logout. v2 if needed.
- No Terraform / CDK. Manual setup documented.
- No GraphQL subscriptions (no real-time need).
- No multi-tenant isolation.
- No file uploads / book covers (out of scope; plain text fields only).

---

## Acceptance criteria

The backend is "done" when:

1. All 5 business rules have at least one passing test.
2. The concurrency test passes deterministically (10 runs, 0 false positives).
3. `docker-compose up` produces a working API at `http://localhost:4000/graphql` with seed data.
4. Push to `main` triggers GHA → tests pass → image builds → migrations run → ECS service updates → `https://<api-domain>/health` returns 200.
5. The frontend (Vercel) can register, login, list books, reserve, return, and an admin can do CRUD against the deployed API end-to-end.
