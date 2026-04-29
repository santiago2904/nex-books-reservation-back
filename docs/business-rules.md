# Business rules and where they are enforced

The 5 rules from the assessment, mapped to the layer that enforces them and the test that proves it.

| # | Rule | Enforced in | Test |
|---|------|-------------|------|
| **R1** | Reservation requires user, book, `reservedAt`, `dueDate`; `dueDate > reservedAt` | `CreateReservationInput` (class-validator on `dueDate`, `bookId`) + `ReservationsService.create` (rejects if `dueDate <= now`) | E2E smoke verified via curl; full Jest suite pending |
| **R2** | A copy cannot have more than one **active** reservation | Postgres partial unique index `reservation_active_per_copy ON Reservation(bookCopyId) WHERE status='ACTIVE'` + `ReservationsService.create` retry-on-`P2002` | `test/concurrency.test.ts` — 10 simultaneous reservations for a single-copy book → exactly 1 succeeds |
| **R3** | A book may be returned **before** its `dueDate` | `ReservationsService.returnBook` only requires `status === 'ACTIVE'`; never compares against `dueDate` | E2E smoke: created reservation with `dueDate = now + 1 day`, immediately returned → `RETURNED`, `bookCopy.status = AVAILABLE` |
| **R4** | A user may have at most **3 active reservations** simultaneously | `ReservationsService.create` runs `count(reservation WHERE userId=X AND status='ACTIVE') < 3` before insert | E2E smoke: 4th reservation by same user returns `MAX_ACTIVE_RESERVATIONS` |
| **R5** | Reservation queries by user and by book must support **date filters** | Resolver args `from`, `to` on `myReservations`, `reservationsByBook`, `reservationsByUser`; service applies `WHERE reservedAt BETWEEN from AND to` | Per-query smoke test in plan; full Jest suite pending |

## Plus: idempotency

`createReservation(input: { idempotencyKey })` — if the same `(userId, idempotencyKey)` was already used, the service returns the existing reservation instead of creating a new one. Solves the "user double-clicks submit" problem. Enforced by the `@@unique([userId, idempotencyKey])` constraint on `Reservation` plus a pre-check inside the service.

## Plus: ownership on return

`returnBook` allows only the reservation's owner OR an `ADMIN`. Verified by smoke test — non-owner USER gets `FORBIDDEN`, ADMIN succeeds.

## Error codes the API surfaces

| Code | When |
|------|------|
| `MAX_ACTIVE_RESERVATIONS` | R4 |
| `NO_COPIES_AVAILABLE` | R2 (no AVAILABLE copies for book) |
| `RACE_RETRY_EXHAUSTED` | R2 race lost 3× in a row (extremely rare) |
| `RESERVATION_NOT_ACTIVE` | trying to return an already-returned reservation |
| `BOOK_HAS_ACTIVE_RESERVATIONS` | trying to delete a book with active reservations |
| `COPY_NOT_AVAILABLE` | trying to remove a copy that is RESERVED or in MAINTENANCE |
| `INVALID_CREDENTIALS` | login failure |
| `EMAIL_ALREADY_EXISTS` | register/createUser duplicate |
| `INVALID_DUE_DATE` | dueDate ≤ now |
| `FORBIDDEN` | role gate failure |
| `NOT_FOUND` | resource lookup failed |
| `RESOURCE_CONFLICT` | generic Prisma `P2002` mapped by `PrismaExceptionFilter` |

The frontend maps these codes to user-facing Spanish messages in `src/lib/errors.ts`.
