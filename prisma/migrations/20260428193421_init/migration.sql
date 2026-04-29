-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ResStatus" AS ENUM ('ACTIVE', 'RETURNED');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "isbn" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookCopy" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookCopyId" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "status" "ResStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Book_isbn_key" ON "Book"("isbn");

-- CreateIndex
CREATE UNIQUE INDEX "BookCopy_code_key" ON "BookCopy"("code");

-- CreateIndex
CREATE INDEX "BookCopy_bookId_status_idx" ON "BookCopy"("bookId", "status");

-- CreateIndex
CREATE INDEX "Reservation_bookCopyId_status_idx" ON "Reservation"("bookCopyId", "status");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- CreateIndex
CREATE INDEX "Reservation_reservedAt_idx" ON "Reservation"("reservedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_userId_idempotencyKey_key" ON "Reservation"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_bookCopyId_fkey" FOREIGN KEY ("bookCopyId") REFERENCES "BookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
