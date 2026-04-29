-- Partial unique index: enforces R2 (one active reservation per copy) at the DB level.
-- Even with N concurrent transactions racing for the same copy, only one INSERT
-- can satisfy this constraint; the others fail with P2002.
CREATE UNIQUE INDEX "reservation_active_per_copy"
  ON "Reservation" ("bookCopyId")
  WHERE status = 'ACTIVE';
