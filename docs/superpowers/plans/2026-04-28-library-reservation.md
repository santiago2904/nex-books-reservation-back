# Nex Books Reservation Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the NestJS + GraphQL + Prisma + Postgres backend defined in `docs/superpowers/specs/2026-04-28-library-reservation-design.md`, deployable to AWS ECS Fargate via GitHub Actions OIDC.

**Architecture:** Monolithic NestJS app with code-first GraphQL resolvers backed by Prisma. JWT auth with USER/ADMIN roles. Race-safe reservation via Postgres partial unique index + idempotency key. Tests with Jest + Supertest + Testcontainers. Docker multi-stage for prod, docker-compose for local.

**Tech Stack:** Node 20, NestJS 10, TypeScript 5, GraphQL (Apollo Server v4), Prisma 5, PostgreSQL 16, Passport-JWT, bcrypt, Jest, Testcontainers, Docker, AWS ECS/ECR/RDS/ALB, GitHub Actions OIDC.

---

## Conventions

- **Package manager:** `pnpm`. All commands assume pnpm.
- **TDD per service:** test first, fail, implement, pass, commit.
- **Commits:** Conventional commits. One commit per task unless noted.
- **No skips:** complete each task in order. Later tasks reference earlier ones.

---

## Task 1: Bootstrap NestJS project

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore` (extend existing), `.editorconfig`
- Create: `src/main.ts`, `src/app.module.ts`

- [ ] **Step 1: Initialize Nest project**

```bash
pnpm dlx @nestjs/cli new . --skip-git --package-manager pnpm --strict
```

When prompted, accept defaults. The CLI will create the basic structure inside the current directory (the `--package-manager pnpm` flag avoids npm).

- [ ] **Step 2: Install runtime deps**

```bash
pnpm add @nestjs/graphql @nestjs/apollo graphql @apollo/server \
  @nestjs/jwt @nestjs/passport passport passport-jwt \
  @nestjs/throttler \
  @prisma/client \
  bcrypt class-validator class-transformer \
  zod
```

- [ ] **Step 3: Install dev deps**

```bash
pnpm add -D prisma @types/bcrypt @types/passport-jwt \
  @testcontainers/postgresql testcontainers
```

- [ ] **Step 4: Edit `package.json` scripts**

Replace the `scripts` block with:

```json
{
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest",
    "test:unit": "jest --config jest.config.ts --testPathPattern=test/unit",
    "test:integration": "jest --config jest.config.ts --testPathPattern=test/integration --runInBand",
    "test:cov": "jest --coverage",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" }
}
```

Add `"tsx": "^4"` to devDependencies and run `pnpm install`.

- [ ] **Step 5: Commit bootstrap**

```bash
git add -A
git commit -m "chore: bootstrap NestJS project"
```

---

## Task 2: Configure environment with Zod validation

**Files:**
- Create: `src/config/env.ts`, `.env.example`, `.env`

- [ ] **Step 1: Write env validator**

`src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    throw new Error('Environment validation failed');
  }
  return parsed.data;
}
```

- [ ] **Step 2: Write `.env.example`**

```
DATABASE_URL=postgresql://nex:nex@localhost:5432/nex_books
JWT_SECRET=replace-me-with-32-bytes-of-random-hex-or-base64
JWT_EXPIRES_IN=1h
PORT=4000
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

Copy to `.env` for local dev. Confirm `.env` is gitignored (.gitignore already has it).

- [ ] **Step 3: Wire env into bootstrap**

Replace `src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map(s => s.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(env.PORT);
  console.log(`API ready on http://localhost:${env.PORT}/graphql`);
}
bootstrap();
```

- [ ] **Step 4: Verify boot fails on missing env**

```bash
DATABASE_URL= JWT_SECRET= pnpm start:dev
```

Expected: process exits with the validation error from Zod.

- [ ] **Step 5: Commit**

```bash
git add src/config src/main.ts .env.example
git commit -m "feat: validate environment with zod at boot"
```

---

## Task 3: Prisma init + initial schema

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/...`

- [ ] **Step 1: Init Prisma**

```bash
pnpm dlx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` and a `.env` entry. Keep our existing `.env`.

- [ ] **Step 2: Replace `prisma/schema.prisma`**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql" url = env("DATABASE_URL") }

enum Role       { USER  ADMIN }
enum ResStatus  { ACTIVE  RETURNED }
enum CopyStatus { AVAILABLE  RESERVED  MAINTENANCE }

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
  id           String     @id @default(uuid())
  bookId       String
  book         Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  code         String     @unique
  status       CopyStatus @default(AVAILABLE)
  createdAt    DateTime   @default(now())
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

- [ ] **Step 3: Start Postgres locally for migration**

```bash
docker run -d --name nex-pg-tmp -e POSTGRES_PASSWORD=nex -e POSTGRES_USER=nex -e POSTGRES_DB=nex_books -p 5432:5432 postgres:16-alpine
```

Wait ~3 seconds for boot.

- [ ] **Step 4: Create initial migration**

```bash
pnpm prisma migrate dev --name init
```

This generates `prisma/migrations/<timestamp>_init/migration.sql` and applies it.

- [ ] **Step 5: Add partial unique index migration**

```bash
pnpm prisma migrate dev --name reservation_active_per_copy_partial_index --create-only
```

Edit the generated SQL file `prisma/migrations/<timestamp>_reservation_active_per_copy_partial_index/migration.sql` to contain only:

```sql
CREATE UNIQUE INDEX "reservation_active_per_copy"
  ON "Reservation" ("bookCopyId")
  WHERE status = 'ACTIVE';
```

Apply it:

```bash
pnpm prisma migrate dev
```

- [ ] **Step 6: Stop and remove temp container**

```bash
docker stop nex-pg-tmp && docker rm nex-pg-tmp
```

- [ ] **Step 7: Commit**

```bash
git add prisma
git commit -m "feat: prisma schema with multi-copy model and partial unique index"
```

---

## Task 4: PrismaModule + service

**Files:**
- Create: `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`

- [ ] **Step 1: Write PrismaService**

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

- [ ] **Step 2: Write PrismaModule (global)**

```ts
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 3: Wire into AppModule**

Replace `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      playground: process.env.NODE_ENV !== 'production',
      sortSchema: true,
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Verify it boots**

```bash
pnpm start:dev
```

Open `http://localhost:4000/graphql` — Apollo Sandbox should load.
Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add src/prisma src/app.module.ts
git commit -m "feat: prisma module + graphql bootstrap"
```

---

## Task 5: Common error filter + decorators scaffolding

**Files:**
- Create: `src/common/filters/prisma-exception.filter.ts`
- Create: `src/common/decorators/public.decorator.ts`, `src/common/decorators/roles.decorator.ts`, `src/common/decorators/current-user.decorator.ts`

- [ ] **Step 1: Write PrismaExceptionFilter**

```ts
// src/common/filters/prisma-exception.filter.ts
import { ArgumentsHost, Catch, ConflictException, NotFoundException } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements GqlExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, _host: ArgumentsHost) {
    if (error.code === 'P2002') {
      return new ConflictException({ message: 'Resource conflict', code: 'RESOURCE_CONFLICT' });
    }
    if (error.code === 'P2025') {
      return new NotFoundException({ message: 'Resource not found', code: 'NOT_FOUND' });
    }
    return error;
  }
}
```

- [ ] **Step 2: Write decorators**

```ts
// src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```ts
// src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

```ts
// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Role } from '@prisma/client';

export interface AuthUser { userId: string; role: Role; email: string; }

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const gqlCtx = GqlExecutionContext.create(ctx);
    return gqlCtx.getContext().req.user;
  },
);
```

- [ ] **Step 3: Register filter globally**

In `src/main.ts` after `app.useGlobalPipes(...)`:

```ts
app.useGlobalFilters(new (await import('./common/filters/prisma-exception.filter')).PrismaExceptionFilter());
```

(Or import normally at top.)

- [ ] **Step 4: Commit**

```bash
git add src/common src/main.ts
git commit -m "feat: prisma exception filter + auth decorators"
```

---

## Task 6: Test infrastructure (Testcontainers helper)

**Files:**
- Create: `test/helpers/test-app.ts`, `test/helpers/db-cleanup.ts`, `test/helpers/factories.ts`
- Create: `jest.config.ts`

- [ ] **Step 1: Write Jest config**

`jest.config.ts`:

```ts
import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '\\.spec\\.ts$',
  testTimeout: 60_000,
};
export default config;
```

Add `pnpm add -D ts-jest @types/jest` if not present from Nest CLI.

- [ ] **Step 2: Write test-app helper**

```ts
// test/helpers/test-app.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

let container: StartedPostgreSqlContainer;
let app: INestApplication;
let prisma: PrismaService;

export async function setupTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('nex_test').withUsername('nex').withPassword('nex').start();

  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = 'test-secret-of-at-least-32-characters-long-x';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.NODE_ENV = 'test';

  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: process.env });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  prisma = app.get(PrismaService);
  return { app, prisma };
}

export async function teardownTestApp() {
  await app?.close();
  await container?.stop();
}
```

- [ ] **Step 3: Write db-cleanup helper**

```ts
// test/helpers/db-cleanup.ts
import { PrismaService } from '../../src/prisma/prisma.service';

export async function cleanupDb(prisma: PrismaService) {
  await prisma.reservation.deleteMany();
  await prisma.bookCopy.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
}
```

- [ ] **Step 4: Write factories**

```ts
// test/helpers/factories.ts
import { PrismaService } from '../../src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

export async function makeUser(prisma: PrismaService, opts: Partial<{ email: string; role: Role; password: string }> = {}) {
  const password = opts.password ?? 'Test1234!';
  return prisma.user.create({
    data: {
      name: 'Test User',
      email: opts.email ?? `u-${Math.random().toString(36).slice(2)}@nex.test`,
      passwordHash: await bcrypt.hash(password, 4),
      role: opts.role ?? 'USER',
    },
  });
}

export async function makeBookWithCopies(prisma: PrismaService, copies = 1) {
  const id = Math.random().toString(36).slice(2);
  return prisma.book.create({
    data: {
      title: `Book ${id}`,
      author: 'Author',
      copies: { create: Array.from({ length: copies }).map((_, i) => ({ code: `${id}-${i}` })) },
    },
    include: { copies: true },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add jest.config.ts test/helpers
git commit -m "test: testcontainers helper for integration tests"
```

---

## Task 7: AuthModule — password hashing + register (TDD)

**Files:**
- Create: `src/auth/auth.module.ts`, `src/auth/auth.service.ts`
- Create: `src/auth/dto/register.input.ts`, `src/auth/dto/auth-payload.output.ts`
- Create: `test/unit/auth.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/auth.service.spec.ts`:

```ts
import { setupTestApp, teardownTestApp } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AuthService', () => {
  let prisma: PrismaService; let auth: AuthService;
  beforeAll(async () => { const t = await setupTestApp(); prisma = t.prisma; auth = t.app.get(AuthService); });
  afterAll(teardownTestApp);
  beforeEach(() => cleanupDb(prisma));

  it('register hashes password and returns token + user', async () => {
    const result = await auth.register({ name: 'Ana', email: 'ana@nex.test', password: 'Pass1234!' });
    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.user.email).toBe('ana@nex.test');
    const stored = await prisma.user.findUnique({ where: { email: 'ana@nex.test' } });
    expect(stored?.passwordHash).not.toBe('Pass1234!');
  });

  it('register rejects duplicate email', async () => {
    await auth.register({ name: 'Ana', email: 'ana@nex.test', password: 'Pass1234!' });
    await expect(auth.register({ name: 'Ana2', email: 'ana@nex.test', password: 'Pass1234!' }))
      .rejects.toThrow(/EMAIL_ALREADY_EXISTS/);
  });
});
```

- [ ] **Step 2: Write DTOs**

```ts
// src/auth/dto/register.input.ts
import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

@InputType()
export class RegisterInput {
  @Field() @IsString() @MinLength(2) name!: string;
  @Field() @IsEmail() email!: string;
  @Field() @IsString() @MinLength(8) @Matches(/[A-Za-z]/) @Matches(/[0-9]/) password!: string;
}
```

```ts
// src/auth/dto/auth-payload.output.ts
import { Field, ObjectType } from '@nestjs/graphql';
import { UserOutput } from '../../users/dto/user.output';

@ObjectType()
export class AuthPayload {
  @Field() accessToken!: string;
  @Field(() => UserOutput) user!: UserOutput;
}
```

(Will create `UserOutput` in Task 8 — placeholder forward-ref ok for now; tests use AuthService directly.)

- [ ] **Step 3: Write AuthService**

```ts
// src/auth/auth.service.ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(input: { name: string; email: string; password: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException({ message: 'Email already exists', code: 'EMAIL_ALREADY_EXISTS' });
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: 'USER' as Role },
    });
    return { accessToken: this.signToken(user.id, user.role, user.email), user };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return { accessToken: this.signToken(user.id, user.role, user.email), user };
  }

  signToken(userId: string, role: Role, email: string): string {
    return this.jwt.sign({ sub: userId, role, email });
  }
}
```

- [ ] **Step 4: Write AuthModule**

```ts
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.registerAsync({
    useFactory: () => ({ secret: process.env.JWT_SECRET!, signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' } }),
  })],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule.imports`.

- [ ] **Step 5: Run the test — should fail until UserOutput exists**

```bash
pnpm test:unit -- auth.service.spec.ts
```

If it fails on `UserOutput`, defer the AuthPayload reference until Task 8. For now, comment out the AuthPayload import in this task; the service test only needs the service itself.

- [ ] **Step 6: Re-run test, confirm PASS**

- [ ] **Step 7: Commit**

```bash
git add src/auth test/unit/auth.service.spec.ts src/app.module.ts
git commit -m "feat(auth): register service with bcrypt + jwt"
```

---

## Task 8: UsersModule

**Files:**
- Create: `src/users/users.module.ts`, `src/users/users.service.ts`, `src/users/users.resolver.ts`
- Create: `src/users/dto/user.output.ts`, `src/users/dto/create-user.input.ts`

- [ ] **Step 1: Write UserOutput**

```ts
// src/users/dto/user.output.ts
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Role } from '@prisma/client';
registerEnumType(Role, { name: 'Role' });

@ObjectType('User')
export class UserOutput {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() email!: string;
  @Field(() => Role) role!: Role;
  @Field() createdAt!: Date;
}
```

- [ ] **Step 2: Write CreateUserInput (admin-only mutation)**

```ts
// src/users/dto/create-user.input.ts
import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, IsEnum, MinLength, Matches } from 'class-validator';
import { Role } from '@prisma/client';

@InputType()
export class CreateUserInput {
  @Field() @IsString() @MinLength(2) name!: string;
  @Field() @IsEmail() email!: string;
  @Field() @IsString() @MinLength(8) @Matches(/[A-Za-z]/) @Matches(/[0-9]/) password!: string;
  @Field(() => Role) @IsEnum(Role) role!: Role;
}
```

- [ ] **Step 3: Write UsersService**

```ts
// src/users/users.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createUser(input: { name: string; email: string; password: string; role: Role }) {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException({ message: 'Email already exists', code: 'EMAIL_ALREADY_EXISTS' });
    return this.prisma.user.create({
      data: { ...input, passwordHash: await bcrypt.hash(input.password, 12), password: undefined } as any,
    });
  }

  findById(id: string) { return this.prisma.user.findUniqueOrThrow({ where: { id } }); }
}
```

(Cleaner: extract a helper `hashPassword` to `src/auth/password.util.ts` and reuse from both Auth and Users — do that as a small refactor in Task 9 if desired. For now, duplication is acceptable.)

- [ ] **Step 4: Write UsersModule**

```ts
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

Register in AppModule.

- [ ] **Step 5: Restore AuthPayload imports, complete Task 7 dangling reference**

In `src/auth/dto/auth-payload.output.ts` re-enable the `UserOutput` import.

- [ ] **Step 6: Re-run auth tests — confirm PASS**

```bash
pnpm test:unit -- auth.service.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/users src/auth/dto src/app.module.ts
git commit -m "feat(users): users service + UserOutput type"
```

---

## Task 9: JWT strategy + GqlAuthGuard + RolesGuard

**Files:**
- Create: `src/auth/jwt.strategy.ts`, `src/auth/guards/gql-auth.guard.ts`, `src/auth/guards/roles.guard.ts`

- [ ] **Step 1: Write JwtStrategy**

```ts
// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }
  async validate(payload: { sub: string; role: Role; email: string }) {
    return { userId: payload.sub, role: payload.role, email: payload.email };
  }
}
```

- [ ] **Step 2: Write GqlAuthGuard**

```ts
// src/auth/guards/gql-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  getRequest(context: ExecutionContext) {
    return GqlExecutionContext.create(context).getContext().req;
  }
}
```

- [ ] **Step 3: Write RolesGuard**

```ts
// src/auth/guards/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const req = GqlExecutionContext.create(ctx).getContext().req;
    if (!required.includes(req.user?.role)) {
      throw new ForbiddenException({ message: 'Insufficient role', code: 'FORBIDDEN' });
    }
    return true;
  }
}
```

- [ ] **Step 4: Wire GraphQL context to forward req.user**

Update `app.module.ts` GraphQL config to pass `context: ({ req }) => ({ req })`:

```ts
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
  playground: process.env.NODE_ENV !== 'production',
  sortSchema: true,
  context: ({ req }) => ({ req }),
}),
```

- [ ] **Step 5: Register guards globally**

In `app.module.ts` providers:

```ts
import { APP_GUARD } from '@nestjs/core';
import { GqlAuthGuard } from './auth/guards/gql-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { JwtStrategy } from './auth/jwt.strategy';

providers: [
  JwtStrategy,
  { provide: APP_GUARD, useClass: GqlAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

Add to AuthModule providers as well to make `JwtStrategy` injectable.

- [ ] **Step 6: Commit**

```bash
git add src/auth
git commit -m "feat(auth): jwt strategy + gql auth guard + roles guard"
```

---

## Task 10: Auth resolver + LoginInput + AuthPayload

**Files:**
- Create: `src/auth/auth.resolver.ts`, `src/auth/dto/login.input.ts`

- [ ] **Step 1: Write LoginInput**

```ts
// src/auth/dto/login.input.ts
import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, MinLength } from 'class-validator';

@InputType()
export class LoginInput {
  @Field() @IsEmail() email!: string;
  @Field() @IsString() @MinLength(8) password!: string;
}
```

- [ ] **Step 2: Write AuthResolver**

```ts
// src/auth/auth.resolver.ts
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthPayload } from './dto/auth-payload.output';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UserOutput } from '../users/dto/user.output';
import { UsersService } from '../users/users.service';

@Resolver()
export class AuthResolver {
  constructor(private auth: AuthService, private users: UsersService) {}

  @Public() @Mutation(() => AuthPayload)
  register(@Args('input') input: RegisterInput) { return this.auth.register(input); }

  @Public() @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput) { return this.auth.login(input.email, input.password); }

  @Query(() => UserOutput, { name: 'me' })
  me(@CurrentUser() user: AuthUser) { return this.users.findById(user.userId); }
}
```

- [ ] **Step 3: Update AuthModule**

```ts
@Module({
  imports: [UsersModule, JwtModule.registerAsync({ ... })],
  providers: [AuthService, JwtStrategy, AuthResolver],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

Import `UsersModule`. Add `AuthResolver` to providers.

- [ ] **Step 4: Verify GraphQL playground**

```bash
pnpm start:dev
```

Navigate to `http://localhost:4000/graphql`. Confirm `register`, `login`, `me` appear in the schema.

- [ ] **Step 5: Commit**

```bash
git add src/auth
git commit -m "feat(auth): register/login/me resolvers"
```

---

## Task 11: Books module — CRUD + copies (TDD)

**Files:**
- Create: `src/books/books.module.ts`, `src/books/books.service.ts`, `src/books/book-copies.service.ts`
- Create: `src/books/books.resolver.ts`
- Create: `src/books/dto/book.output.ts`, `src/books/dto/book-copy.output.ts`, `src/books/dto/create-book.input.ts`, `src/books/dto/update-book.input.ts`
- Create: `test/unit/books.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/books.service.spec.ts`:

```ts
import { setupTestApp, teardownTestApp } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { BooksService } from '../../src/books/books.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('BooksService', () => {
  let prisma: PrismaService; let books: BooksService;
  beforeAll(async () => { const t = await setupTestApp(); prisma = t.prisma; books = t.app.get(BooksService); });
  afterAll(teardownTestApp);
  beforeEach(() => cleanupDb(prisma));

  it('creates a book with N initial copies', async () => {
    const b = await books.create({ title: 'X', author: 'Y', initialCopies: 3 });
    expect(b.copies).toHaveLength(3);
    expect(b.copies.every(c => c.status === 'AVAILABLE')).toBe(true);
  });

  it('rejects deletion when there are active reservations', async () => {
    const b = await books.create({ title: 'X', author: 'Y', initialCopies: 1 });
    await prisma.bookCopy.update({ where: { id: b.copies[0].id }, data: { status: 'RESERVED' } });
    const user = await prisma.user.create({ data: { name: 'u', email: 'u@x.t', passwordHash: 'h' } });
    await prisma.reservation.create({ data: { userId: user.id, bookCopyId: b.copies[0].id, dueDate: new Date(Date.now() + 86400000) } });
    await expect(books.remove(b.id)).rejects.toThrow(/BOOK_HAS_ACTIVE_RESERVATIONS/);
  });

  it('removeCopy fails if copy is not AVAILABLE', async () => {
    const b = await books.create({ title: 'X', author: 'Y', initialCopies: 1 });
    await prisma.bookCopy.update({ where: { id: b.copies[0].id }, data: { status: 'RESERVED' } });
    await expect(books.removeCopy(b.copies[0].id)).rejects.toThrow(/COPY_NOT_AVAILABLE/);
  });
});
```

- [ ] **Step 2: Write BookOutput + BookCopyOutput + inputs**

```ts
// src/books/dto/book-copy.output.ts
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { CopyStatus } from '@prisma/client';
registerEnumType(CopyStatus, { name: 'CopyStatus' });

@ObjectType('BookCopy')
export class BookCopyOutput {
  @Field(() => ID) id!: string;
  @Field() code!: string;
  @Field(() => CopyStatus) status!: CopyStatus;
}
```

```ts
// src/books/dto/book.output.ts
import { Field, ObjectType, ID, Int } from '@nestjs/graphql';
import { BookCopyOutput } from './book-copy.output';

@ObjectType('Book')
export class BookOutput {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() author!: string;
  @Field({ nullable: true }) isbn?: string | null;
  @Field({ nullable: true }) description?: string | null;
  @Field(() => Int) totalCopies!: number;
  @Field(() => Int) availableCopies!: number;
  @Field(() => [BookCopyOutput]) copies!: BookCopyOutput[];
  @Field() createdAt!: Date;
  @Field() updatedAt!: Date;
}
```

```ts
// src/books/dto/create-book.input.ts
import { Field, InputType, Int } from '@nestjs/graphql';
import { IsString, IsOptional, IsInt, Min, MinLength } from 'class-validator';

@InputType()
export class CreateBookInput {
  @Field() @IsString() @MinLength(1) title!: string;
  @Field() @IsString() @MinLength(1) author!: string;
  @Field({ nullable: true }) @IsOptional() @IsString() isbn?: string;
  @Field({ nullable: true }) @IsOptional() @IsString() description?: string;
  @Field(() => Int) @IsInt() @Min(1) initialCopies!: number;
}
```

```ts
// src/books/dto/update-book.input.ts
import { Field, InputType } from '@nestjs/graphql';
import { IsString, IsOptional, MinLength } from 'class-validator';

@InputType()
export class UpdateBookInput {
  @Field({ nullable: true }) @IsOptional() @IsString() @MinLength(1) title?: string;
  @Field({ nullable: true }) @IsOptional() @IsString() @MinLength(1) author?: string;
  @Field({ nullable: true }) @IsOptional() @IsString() isbn?: string;
  @Field({ nullable: true }) @IsOptional() @IsString() description?: string;
}
```

- [ ] **Step 3: Write BooksService**

```ts
// src/books/books.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class BooksService {
  constructor(private prisma: PrismaService) {}

  async create(input: { title: string; author: string; isbn?: string; description?: string; initialCopies: number }) {
    const code = (i: number) => `${(input.isbn ?? 'NOISBN')}-${Date.now()}-${i}`;
    return this.prisma.book.create({
      data: {
        title: input.title, author: input.author, isbn: input.isbn ?? null, description: input.description ?? null,
        copies: { create: Array.from({ length: input.initialCopies }).map((_, i) => ({ code: code(i) })) },
      },
      include: { copies: true },
    });
  }

  async update(id: string, input: { title?: string; author?: string; isbn?: string; description?: string }) {
    const updated = await this.prisma.book.update({ where: { id }, data: input, include: { copies: true } });
    return updated;
  }

  async remove(id: string) {
    const active = await this.prisma.reservation.count({
      where: { status: 'ACTIVE', bookCopy: { bookId: id } },
    });
    if (active > 0) {
      throw new BadRequestException({ message: 'Book has active reservations', code: 'BOOK_HAS_ACTIVE_RESERVATIONS' });
    }
    await this.prisma.book.delete({ where: { id } });
    return true;
  }

  async findAll(opts: { available?: boolean }) {
    const books = await this.prisma.book.findMany({ include: { copies: true }, orderBy: { title: 'asc' } });
    if (opts.available) return books.filter(b => b.copies.some(c => c.status === 'AVAILABLE'));
    return books;
  }

  async findOne(id: string) {
    const book = await this.prisma.book.findUnique({ where: { id }, include: { copies: true } });
    if (!book) throw new NotFoundException({ message: 'Book not found', code: 'NOT_FOUND' });
    return book;
  }

  async addCopy(bookId: string) {
    const code = `${bookId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 4)}`;
    return this.prisma.bookCopy.create({ data: { bookId, code } });
  }

  async removeCopy(copyId: string) {
    const copy = await this.prisma.bookCopy.findUnique({ where: { id: copyId } });
    if (!copy) throw new NotFoundException({ message: 'Copy not found', code: 'NOT_FOUND' });
    if (copy.status !== 'AVAILABLE') {
      throw new BadRequestException({ message: 'Copy not available', code: 'COPY_NOT_AVAILABLE' });
    }
    await this.prisma.bookCopy.delete({ where: { id: copyId } });
    return true;
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm test:unit -- books.service.spec.ts
```

If tests fail, fix the service until they pass.

- [ ] **Step 5: Write BooksResolver**

```ts
// src/books/books.resolver.ts
import { Args, ID, Mutation, Query, ResolveField, Resolver, Parent, Int } from '@nestjs/graphql';
import { BookOutput } from './dto/book.output';
import { BookCopyOutput } from './dto/book-copy.output';
import { CreateBookInput } from './dto/create-book.input';
import { UpdateBookInput } from './dto/update-book.input';
import { BooksService } from './books.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Resolver(() => BookOutput)
export class BooksResolver {
  constructor(private books: BooksService) {}

  @Public() @Query(() => [BookOutput])
  booksList(@Args('available', { nullable: true }) available?: boolean) {
    return this.books.findAll({ available });
  }

  @Public() @Query(() => BookOutput, { nullable: true, name: 'book' })
  bookById(@Args('id', { type: () => ID }) id: string) { return this.books.findOne(id); }

  @Roles('ADMIN') @Mutation(() => BookOutput)
  createBook(@Args('input') input: CreateBookInput) { return this.books.create(input); }

  @Roles('ADMIN') @Mutation(() => BookOutput)
  updateBook(@Args('id', { type: () => ID }) id: string, @Args('input') input: UpdateBookInput) {
    return this.books.update(id, input);
  }

  @Roles('ADMIN') @Mutation(() => Boolean)
  deleteBook(@Args('id', { type: () => ID }) id: string) { return this.books.remove(id); }

  @Roles('ADMIN') @Mutation(() => BookCopyOutput)
  addBookCopy(@Args('bookId', { type: () => ID }) bookId: string) { return this.books.addCopy(bookId); }

  @Roles('ADMIN') @Mutation(() => Boolean)
  removeBookCopy(@Args('copyId', { type: () => ID }) copyId: string) { return this.books.removeCopy(copyId); }

  @ResolveField(() => Int)
  totalCopies(@Parent() book: any): number { return book.copies?.length ?? 0; }

  @ResolveField(() => Int)
  availableCopies(@Parent() book: any): number {
    return (book.copies ?? []).filter((c: any) => c.status === 'AVAILABLE').length;
  }
}
```

Note: The query is named `booksList` (avoiding the `books` field clash on the `Book` parent type). Spec says public query is `books` — rename to `books` only if you remove the field-resolver collision; otherwise expose it as `books` via the explicit `@Query(() => [BookOutput], { name: 'books' })`.

To keep the spec contract: change to `@Query(() => [BookOutput], { name: 'books' })`.

- [ ] **Step 6: Write BooksModule**

```ts
// src/books/books.module.ts
import { Module } from '@nestjs/common';
import { BooksService } from './books.service';
import { BooksResolver } from './books.resolver';

@Module({ providers: [BooksService, BooksResolver], exports: [BooksService] })
export class BooksModule {}
```

Add to AppModule.

- [ ] **Step 7: Commit**

```bash
git add src/books test/unit/books.service.spec.ts src/app.module.ts
git commit -m "feat(books): CRUD + copy management with admin guards"
```

---

## Task 12: Reservations module — happy path & R4 (TDD)

**Files:**
- Create: `src/reservations/reservations.module.ts`, `src/reservations/reservations.service.ts`
- Create: `src/reservations/dto/create-reservation.input.ts`, `src/reservations/dto/reservation.output.ts`, `src/reservations/dto/reservation-filters.input.ts`
- Create: `test/unit/reservations.service.spec.ts`

- [ ] **Step 1: Write failing tests for create + R4**

`test/unit/reservations.service.spec.ts`:

```ts
import { setupTestApp, teardownTestApp } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { makeUser, makeBookWithCopies } from '../helpers/factories';
import { ReservationsService } from '../../src/reservations/reservations.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('ReservationsService', () => {
  let prisma: PrismaService; let svc: ReservationsService;
  beforeAll(async () => { const t = await setupTestApp(); prisma = t.prisma; svc = t.app.get(ReservationsService); });
  afterAll(teardownTestApp);
  beforeEach(() => cleanupDb(prisma));

  const tomorrow = () => new Date(Date.now() + 86400000);

  it('creates a reservation when copies are available (R1)', async () => {
    const user = await makeUser(prisma);
    const book = await makeBookWithCopies(prisma, 2);
    const r = await svc.create({ userId: user.id, bookId: book.id, dueDate: tomorrow() });
    expect(r.status).toBe('ACTIVE');
    const copy = await prisma.bookCopy.findUnique({ where: { id: r.bookCopyId } });
    expect(copy?.status).toBe('RESERVED');
  });

  it('rejects when no copies are available (R2)', async () => {
    const user = await makeUser(prisma);
    const book = await makeBookWithCopies(prisma, 1);
    await svc.create({ userId: user.id, bookId: book.id, dueDate: tomorrow() });
    const user2 = await makeUser(prisma);
    await expect(svc.create({ userId: user2.id, bookId: book.id, dueDate: tomorrow() }))
      .rejects.toThrow(/NO_COPIES_AVAILABLE/);
  });

  it('rejects 4th active reservation per user (R4)', async () => {
    const user = await makeUser(prisma);
    for (let i = 0; i < 3; i++) {
      const b = await makeBookWithCopies(prisma, 1);
      await svc.create({ userId: user.id, bookId: b.id, dueDate: tomorrow() });
    }
    const b4 = await makeBookWithCopies(prisma, 1);
    await expect(svc.create({ userId: user.id, bookId: b4.id, dueDate: tomorrow() }))
      .rejects.toThrow(/MAX_ACTIVE_RESERVATIONS/);
  });

  it('idempotency key returns same reservation', async () => {
    const user = await makeUser(prisma);
    const book = await makeBookWithCopies(prisma, 1);
    const key = 'idem-1';
    const r1 = await svc.create({ userId: user.id, bookId: book.id, dueDate: tomorrow(), idempotencyKey: key });
    const r2 = await svc.create({ userId: user.id, bookId: book.id, dueDate: tomorrow(), idempotencyKey: key });
    expect(r2.id).toBe(r1.id);
  });
});
```

- [ ] **Step 2: Write Reservation DTOs**

```ts
// src/reservations/dto/create-reservation.input.ts
import { Field, InputType, ID } from '@nestjs/graphql';
import { IsUUID, IsDate, IsOptional, IsString, MinDate } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class CreateReservationInput {
  @Field(() => ID) @IsUUID() bookId!: string;
  @Field() @IsDate() @Type(() => Date) @MinDate(new Date()) dueDate!: Date;
  @Field({ nullable: true }) @IsOptional() @IsString() idempotencyKey?: string;
}
```

```ts
// src/reservations/dto/reservation.output.ts
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { ResStatus } from '@prisma/client';
import { UserOutput } from '../../users/dto/user.output';
import { BookCopyOutput } from '../../books/dto/book-copy.output';
registerEnumType(ResStatus, { name: 'ResStatus' });

@ObjectType('Reservation')
export class ReservationOutput {
  @Field(() => ID) id!: string;
  @Field(() => UserOutput) user!: UserOutput;
  @Field(() => BookCopyOutput) bookCopy!: BookCopyOutput;
  @Field() reservedAt!: Date;
  @Field() dueDate!: Date;
  @Field({ nullable: true }) returnedAt?: Date | null;
  @Field(() => ResStatus) status!: ResStatus;
}
```

```ts
// src/reservations/dto/reservation-filters.input.ts
import { Field, InputType } from '@nestjs/graphql';
import { IsDate, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ResStatus } from '@prisma/client';

@InputType()
export class ReservationFiltersInput {
  @Field({ nullable: true }) @IsOptional() @IsDate() @Type(() => Date) from?: Date;
  @Field({ nullable: true }) @IsOptional() @IsDate() @Type(() => Date) to?: Date;
  @Field(() => ResStatus, { nullable: true }) @IsOptional() @IsEnum(ResStatus) status?: ResStatus;
}
```

- [ ] **Step 3: Write ReservationsService**

```ts
// src/reservations/reservations.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ResStatus } from '@prisma/client';

const MAX_ACTIVE = 3;
const MAX_ATTEMPTS = 3;

@Injectable()
export class ReservationsService {
  constructor(private prisma: PrismaService) {}

  async create(input: { userId: string; bookId: string; dueDate: Date; idempotencyKey?: string }) {
    if (input.dueDate.getTime() <= Date.now()) {
      throw new BadRequestException({ message: 'dueDate must be in the future', code: 'INVALID_DUE_DATE' });
    }

    if (input.idempotencyKey) {
      const existing = await this.prisma.reservation.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return existing;
    }

    const active = await this.prisma.reservation.count({
      where: { userId: input.userId, status: 'ACTIVE' },
    });
    if (active >= MAX_ACTIVE) {
      throw new BadRequestException({ message: 'Max active reservations reached', code: 'MAX_ACTIVE_RESERVATIONS' });
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const copy = await this.prisma.bookCopy.findFirst({
        where: { bookId: input.bookId, status: 'AVAILABLE' },
      });
      if (!copy) {
        throw new BadRequestException({ message: 'No copies available', code: 'NO_COPIES_AVAILABLE' });
      }
      try {
        const [reservation] = await this.prisma.$transaction([
          this.prisma.reservation.create({
            data: {
              userId: input.userId, bookCopyId: copy.id, dueDate: input.dueDate,
              idempotencyKey: input.idempotencyKey ?? null, status: 'ACTIVE',
            },
          }),
          this.prisma.bookCopy.update({
            where: { id: copy.id, status: 'AVAILABLE' } as any,
            data: { status: 'RESERVED' },
          }),
        ]);
        return reservation;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException({ message: 'Race retry exhausted', code: 'RACE_RETRY_EXHAUSTED' });
  }

  async returnBook(reservationId: string, requester: { userId: string; role: string }) {
    const r = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!r) throw new NotFoundException({ message: 'Reservation not found', code: 'NOT_FOUND' });
    if (r.userId !== requester.userId && requester.role !== 'ADMIN') {
      throw new ForbiddenException({ message: 'Forbidden', code: 'FORBIDDEN' });
    }
    if (r.status !== 'ACTIVE') {
      throw new BadRequestException({ message: 'Reservation not active', code: 'RESERVATION_NOT_ACTIVE' });
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.reservation.update({ where: { id: reservationId }, data: { status: 'RETURNED', returnedAt: new Date() } }),
      this.prisma.bookCopy.update({ where: { id: r.bookCopyId }, data: { status: 'AVAILABLE' } }),
    ]);
    return updated;
  }

  myReservations(userId: string, filters: { from?: Date; to?: Date; status?: ResStatus }) {
    return this.prisma.reservation.findMany({
      where: {
        userId,
        status: filters.status,
        reservedAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }

  reservationsByBook(bookId: string, filters: { from?: Date; to?: Date }) {
    return this.prisma.reservation.findMany({
      where: {
        bookCopy: { bookId },
        reservedAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }

  reservationsByUser(userId: string, filters: { from?: Date; to?: Date }) {
    return this.prisma.reservation.findMany({
      where: {
        userId,
        reservedAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }
}
```

- [ ] **Step 4: Write ReservationsModule + AppModule wiring**

```ts
// src/reservations/reservations.module.ts
import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';

@Module({ providers: [ReservationsService], exports: [ReservationsService] })
export class ReservationsModule {}
```

Add to AppModule.

- [ ] **Step 5: Run unit tests**

```bash
pnpm test:unit -- reservations.service.spec.ts
```

Fix until all pass.

- [ ] **Step 6: Commit**

```bash
git add src/reservations test/unit/reservations.service.spec.ts src/app.module.ts
git commit -m "feat(reservations): create + return + queries with R1/R2/R4 + idempotency"
```

---

## Task 13: Reservation R3, R5, ownership tests + return flow tests

**Files:**
- Modify: `test/unit/reservations.service.spec.ts`

- [ ] **Step 1: Add R3 + return tests**

Append to the existing spec:

```ts
it('returnBook before dueDate succeeds (R3)', async () => {
  const user = await makeUser(prisma);
  const book = await makeBookWithCopies(prisma, 1);
  const r = await svc.create({ userId: user.id, bookId: book.id, dueDate: new Date(Date.now() + 86400000 * 7) });
  const returned = await svc.returnBook(r.id, { userId: user.id, role: 'USER' });
  expect(returned.status).toBe('RETURNED');
  expect(returned.returnedAt).not.toBeNull();
  const copy = await prisma.bookCopy.findUnique({ where: { id: r.bookCopyId } });
  expect(copy?.status).toBe('AVAILABLE');
});

it('returnBook by non-owner USER fails', async () => {
  const u1 = await makeUser(prisma);
  const u2 = await makeUser(prisma);
  const book = await makeBookWithCopies(prisma, 1);
  const r = await svc.create({ userId: u1.id, bookId: book.id, dueDate: new Date(Date.now() + 86400000) });
  await expect(svc.returnBook(r.id, { userId: u2.id, role: 'USER' })).rejects.toThrow(/FORBIDDEN/);
});

it('returnBook by ADMIN succeeds for any user', async () => {
  const owner = await makeUser(prisma);
  const admin = await makeUser(prisma, { role: 'ADMIN' });
  const book = await makeBookWithCopies(prisma, 1);
  const r = await svc.create({ userId: owner.id, bookId: book.id, dueDate: new Date(Date.now() + 86400000) });
  const returned = await svc.returnBook(r.id, { userId: admin.id, role: 'ADMIN' });
  expect(returned.status).toBe('RETURNED');
});

it('myReservations filters by date range (R5)', async () => {
  const user = await makeUser(prisma);
  const b1 = await makeBookWithCopies(prisma, 1);
  await svc.create({ userId: user.id, bookId: b1.id, dueDate: new Date(Date.now() + 86400000) });
  const inWindow = await svc.myReservations(user.id, { from: new Date(Date.now() - 3600000), to: new Date(Date.now() + 3600000) });
  expect(inWindow).toHaveLength(1);
  const outOfWindow = await svc.myReservations(user.id, { from: new Date(Date.now() - 7 * 86400000), to: new Date(Date.now() - 86400000) });
  expect(outOfWindow).toHaveLength(0);
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
pnpm test:unit -- reservations.service.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/unit/reservations.service.spec.ts
git commit -m "test: cover R3, R5, ownership for returnBook"
```

---

## Task 14: Concurrency integration test

**Files:**
- Create: `test/integration/concurrency.e2e-spec.ts`

- [ ] **Step 1: Write the test**

```ts
// test/integration/concurrency.e2e-spec.ts
import { setupTestApp, teardownTestApp } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { makeUser, makeBookWithCopies } from '../helpers/factories';
import { ReservationsService } from '../../src/reservations/reservations.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Reservations concurrency', () => {
  let prisma: PrismaService; let svc: ReservationsService;
  beforeAll(async () => { const t = await setupTestApp(); prisma = t.prisma; svc = t.app.get(ReservationsService); });
  afterAll(teardownTestApp);
  beforeEach(() => cleanupDb(prisma));

  it('only one of N concurrent reservations for the last copy succeeds', async () => {
    const book = await makeBookWithCopies(prisma, 1);
    const users = await Promise.all(Array(10).fill(0).map(() => makeUser(prisma)));
    const dueDate = new Date(Date.now() + 86400000);
    const settled = await Promise.allSettled(
      users.map(u => svc.create({ userId: u.id, bookId: book.id, dueDate })),
    );
    const fulfilled = settled.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const active = await prisma.reservation.count({ where: { status: 'ACTIVE', bookCopy: { bookId: book.id } } });
    expect(active).toBe(1);
  }, 30_000);
});
```

- [ ] **Step 2: Run integration test**

```bash
pnpm test:integration -- concurrency
```

Expected: PASS. (`runInBand` ensures only one Postgres container at a time.)

- [ ] **Step 3: Commit**

```bash
git add test/integration
git commit -m "test: concurrency — only one wins for last copy"
```

---

## Task 15: Reservations resolver

**Files:**
- Create: `src/reservations/reservations.resolver.ts`
- Modify: `src/reservations/reservations.module.ts`

- [ ] **Step 1: Write resolver**

```ts
// src/reservations/reservations.resolver.ts
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ReservationsService } from './reservations.service';
import { ReservationOutput } from './dto/reservation.output';
import { CreateReservationInput } from './dto/create-reservation.input';
import { ReservationFiltersInput } from './dto/reservation-filters.input';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Resolver(() => ReservationOutput)
export class ReservationsResolver {
  constructor(private svc: ReservationsService) {}

  @Mutation(() => ReservationOutput)
  createReservation(@CurrentUser() user: AuthUser, @Args('input') input: CreateReservationInput) {
    return this.svc.create({
      userId: user.userId, bookId: input.bookId, dueDate: input.dueDate, idempotencyKey: input.idempotencyKey,
    });
  }

  @Mutation(() => ReservationOutput)
  returnBook(@CurrentUser() user: AuthUser, @Args('reservationId', { type: () => ID }) reservationId: string) {
    return this.svc.returnBook(reservationId, { userId: user.userId, role: user.role });
  }

  @Query(() => [ReservationOutput])
  myReservations(@CurrentUser() user: AuthUser, @Args('filters', { nullable: true }) filters?: ReservationFiltersInput) {
    return this.svc.myReservations(user.userId, filters ?? {});
  }

  @Roles('ADMIN') @Query(() => [ReservationOutput])
  reservationsByBook(
    @Args('bookId', { type: () => ID }) bookId: string,
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.reservationsByBook(bookId, filters ?? {});
  }

  @Roles('ADMIN') @Query(() => [ReservationOutput])
  reservationsByUser(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.reservationsByUser(userId, filters ?? {});
  }
}
```

- [ ] **Step 2: Add to module providers**

```ts
@Module({ providers: [ReservationsService, ReservationsResolver], exports: [ReservationsService] })
```

- [ ] **Step 3: Boot and inspect schema**

```bash
pnpm start:dev
```

In Apollo Sandbox confirm `createReservation`, `returnBook`, `myReservations`, `reservationsByBook`, `reservationsByUser` exist.

- [ ] **Step 4: Commit**

```bash
git add src/reservations
git commit -m "feat(reservations): graphql resolver"
```

---

## Task 16: Users resolver (admin createUser)

**Files:**
- Create: `src/users/users.resolver.ts`
- Modify: `src/users/users.module.ts`

- [ ] **Step 1: Write resolver**

```ts
// src/users/users.resolver.ts
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UserOutput } from './dto/user.output';
import { CreateUserInput } from './dto/create-user.input';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';

@Resolver(() => UserOutput)
export class UsersResolver {
  constructor(private users: UsersService) {}

  @Roles('ADMIN') @Mutation(() => UserOutput)
  createUser(@Args('input') input: CreateUserInput) { return this.users.createUser(input); }
}
```

- [ ] **Step 2: Add to providers**

```ts
@Module({ providers: [UsersService, UsersResolver], exports: [UsersService] })
```

- [ ] **Step 3: Commit**

```bash
git add src/users
git commit -m "feat(users): admin createUser mutation"
```

---

## Task 17: End-to-end auth + reservation integration test

**Files:**
- Create: `test/integration/reservation-flow.e2e-spec.ts`

- [ ] **Step 1: Write the test (uses Supertest against the running Nest app)**

```ts
// test/integration/reservation-flow.e2e-spec.ts
import * as request from 'supertest';
import { setupTestApp, teardownTestApp } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';

const REGISTER = `mutation($i: RegisterInput!){ register(input:$i){ accessToken user{ id email role } } }`;
const CREATE_BOOK = `mutation($i: CreateBookInput!){ createBook(input:$i){ id copies{ id status } } }`;
const RESERVE = `mutation($i: CreateReservationInput!){ createReservation(input:$i){ id status } }`;
const RETURN = `mutation($id: ID!){ returnBook(reservationId:$id){ id status returnedAt } }`;
const MY = `query($f: ReservationFiltersInput){ myReservations(filters:$f){ id status } }`;

describe('Auth + reservation E2E', () => {
  let app: any; let prisma: any;
  beforeAll(async () => { const t = await setupTestApp(); app = t.app; prisma = t.prisma; });
  afterAll(teardownTestApp);
  beforeEach(() => cleanupDb(prisma));

  async function gql(query: string, variables?: any, token?: string) {
    const req = request(app.getHttpServer()).post('/graphql');
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.send({ query, variables });
    return res.body;
  }

  it('register → admin create book → user reserve → return', async () => {
    // Register a user (USER role)
    const userR = await gql(REGISTER, { i: { name: 'Ana', email: 'ana@nex.test', password: 'Pass1234!' } });
    const userToken = userR.data.register.accessToken;

    // Manually elevate one user to ADMIN to create a book (simulating seed)
    await prisma.user.update({ where: { email: 'ana@nex.test' }, data: { role: 'ADMIN' } });
    // Get fresh token by login (role embedded in JWT)
    const adminLogin = await gql(`mutation{ login(input:{ email:"ana@nex.test", password:"Pass1234!"}){ accessToken } }`);
    const adminToken = adminLogin.data.login.accessToken;

    const cb = await gql(CREATE_BOOK, { i: { title: 'X', author: 'Y', initialCopies: 1 } }, adminToken);
    const bookId = cb.data.createBook.id;

    // Register user2
    const u2 = await gql(REGISTER, { i: { name: 'Bob', email: 'bob@nex.test', password: 'Pass1234!' } });
    const u2Token = u2.data.register.accessToken;

    // Reserve
    const dueDate = new Date(Date.now() + 86400000).toISOString();
    const rv = await gql(RESERVE, { i: { bookId, dueDate } }, u2Token);
    const reservationId = rv.data.createReservation.id;

    // myReservations shows it
    const my = await gql(MY, { f: null }, u2Token);
    expect(my.data.myReservations).toHaveLength(1);

    // Return
    const ret = await gql(RETURN, { id: reservationId }, u2Token);
    expect(ret.data.returnBook.status).toBe('RETURNED');
    expect(ret.data.returnBook.returnedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Install supertest**

```bash
pnpm add -D supertest @types/supertest
```

- [ ] **Step 3: Run integration**

```bash
pnpm test:integration -- reservation-flow
```

Expect PASS.

- [ ] **Step 4: Commit**

```bash
git add test/integration/reservation-flow.e2e-spec.ts package.json pnpm-lock.yaml
git commit -m "test: e2e register + reserve + return flow via graphql"
```

---

## Task 18: Health endpoints

**Files:**
- Create: `src/health/health.controller.ts`, `src/health/health.module.ts`

- [ ] **Step 1: Write controller**

```ts
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Public() @Get() liveness() { return { status: 'ok' }; }
  @Public() @Get('ready') async readiness() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }
}
```

- [ ] **Step 2: Wire module**

```ts
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

Add to AppModule. Note: `GqlAuthGuard` only intercepts GraphQL — REST controllers ignore it. The `@Public()` is defensive for if guards apply globally to REST too. Confirm by hitting `/health` without token after boot.

- [ ] **Step 3: Verify**

```bash
pnpm start:dev
curl http://localhost:4000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add src/health src/app.module.ts
git commit -m "feat: liveness + readiness endpoints"
```

---

## Task 19: Throttler on auth endpoints

**Files:**
- Modify: `src/app.module.ts`, `src/auth/auth.resolver.ts`

- [ ] **Step 1: Configure ThrottlerModule globally**

In `app.module.ts`:

```ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

imports: [
  ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
  // ... other modules
],
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  // ... other guards (order matters; throttler first)
],
```

- [ ] **Step 2: Apply stricter throttle on register/login**

```ts
import { Throttle } from '@nestjs/throttler';

@Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Mutation(() => AuthPayload)
register(@Args('input') input: RegisterInput) { return this.auth.register(input); }

@Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Mutation(() => AuthPayload)
login(@Args('input') input: LoginInput) { return this.auth.login(input.email, input.password); }
```

- [ ] **Step 3: Boot and confirm rate-limit kicks at 11th request**

(Manual smoke; no automated test.)

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts src/auth/auth.resolver.ts
git commit -m "feat: throttle login + register at 10/min"
```

---

## Task 20: Seeds

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: Write seed**

```ts
// prisma/seed.ts
import { PrismaClient, Role, CopyStatus, ResStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
const prisma = new PrismaClient();

async function main() {
  await prisma.reservation.deleteMany();
  await prisma.bookCopy.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: { name: 'Admin', email: 'admin@nex.test', passwordHash: await bcrypt.hash('Admin123!', 12), role: Role.ADMIN },
  });
  const ana = await prisma.user.create({
    data: { name: 'Ana', email: 'ana@nex.test', passwordHash: await bcrypt.hash('User1234!', 12), role: Role.USER },
  });
  const bruno = await prisma.user.create({
    data: { name: 'Bruno', email: 'bruno@nex.test', passwordHash: await bcrypt.hash('User1234!', 12), role: Role.USER },
  });

  const titles: Array<[string, string, number]> = [
    ['Cien años de soledad', 'Gabriel García Márquez', 3],
    ['La sombra del viento', 'Carlos Ruiz Zafón', 2],
    ['Rayuela', 'Julio Cortázar', 2],
    ['Pedro Páramo', 'Juan Rulfo', 2],
    ['El Aleph', 'Jorge Luis Borges', 3],
    ['Ficciones', 'Jorge Luis Borges', 2],
    ['Como agua para chocolate', 'Laura Esquivel', 1],
    ['La casa de los espíritus', 'Isabel Allende', 2],
    ['Crónica de una muerte anunciada', 'Gabriel García Márquez', 3],
    ['Clean Code', 'Robert C. Martin', 4],
    ['The Pragmatic Programmer', 'Andrew Hunt', 4],
    ['Domain-Driven Design', 'Eric Evans', 2],
    ['Designing Data-Intensive Applications', 'Martin Kleppmann', 3],
    ['Sapiens', 'Yuval Noah Harari', 3],
    ['Project Hail Mary', 'Andy Weir', 4],
  ];

  for (const [title, author, copies] of titles) {
    await prisma.book.create({
      data: {
        title, author,
        copies: { create: Array.from({ length: copies }).map((_, i) => ({ code: `${title.slice(0, 4).toUpperCase()}-${i + 1}` })) },
      },
    });
  }

  // Active reservations to populate dashboards
  const firstBook = await prisma.book.findFirst({ where: { title: 'Cien años de soledad' }, include: { copies: true } });
  if (firstBook) {
    const copy = firstBook.copies[0];
    await prisma.bookCopy.update({ where: { id: copy.id }, data: { status: CopyStatus.RESERVED } });
    await prisma.reservation.create({
      data: { userId: ana.id, bookCopyId: copy.id, status: ResStatus.ACTIVE,
              dueDate: new Date(Date.now() + 7 * 86400000) },
    });
  }

  console.log('Seed complete:');
  console.log('  admin@nex.test / Admin123!');
  console.log('  ana@nex.test   / User1234!');
  console.log('  bruno@nex.test / User1234!');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run seed**

```bash
pnpm prisma:seed
```

Expect successful output.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: prisma seed with admin + 2 users + 15 books"
```

---

## Task 21: Dockerfile (multi-stage)

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && apk add --no-cache dumb-init
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json .
ENV NODE_ENV=production
EXPOSE 4000
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.git
.env
.env.*
!.env.example
test
docs
*.md
coverage
```

- [ ] **Step 3: Build the image**

```bash
docker build -t nex-books-back:dev .
```

Expect successful build.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile for production"
```

---

## Task 22: docker-compose for local dev

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write compose file**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nex
      POSTGRES_PASSWORD: nex
      POSTGRES_DB: nex_books
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nex"]
      interval: 3s
      retries: 10

  api:
    build: .
    environment:
      DATABASE_URL: postgresql://nex:nex@db:5432/nex_books
      JWT_SECRET: dev-secret-of-at-least-32-characters-long-x
      JWT_EXPIRES_IN: 1h
      PORT: 4000
      CORS_ORIGIN: http://localhost:5173
      NODE_ENV: development
    depends_on:
      db: { condition: service_healthy }
    ports: ["4000:4000"]
    command: sh -c "pnpm prisma migrate deploy && pnpm prisma db seed && node dist/main.js"

  adminer:
    image: adminer
    ports: ["8080:8080"]

volumes:
  pgdata:
```

- [ ] **Step 2: Boot the stack**

```bash
docker compose up --build
```

Expect: API ready on `http://localhost:4000/graphql`, seed output in logs, Adminer at `http://localhost:8080`.

- [ ] **Step 3: Smoke test**

```bash
curl http://localhost:4000/health
```

Expect `{"status":"ok"}`. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "build: docker-compose with postgres + api + adminer"
```

---

## Task 23: README + AWS setup docs

**Files:**
- Create: `README.md`, `docs/aws-setup.md`, `docs/business-rules.md`

- [ ] **Step 1: Write README**

`README.md`:

```markdown
# Nex Books Reservation — Backend

NestJS + GraphQL + Prisma + PostgreSQL. JWT auth with USER/ADMIN roles. Multi-copy books with race-safe reservations.

## Quick start (local)

```bash
docker compose up --build
```

API at http://localhost:4000/graphql · Adminer at http://localhost:8080.

Seed credentials:
- `admin@nex.test` / `Admin123!`
- `ana@nex.test` / `User1234!`
- `bruno@nex.test` / `User1234!`

## Without Docker

```bash
pnpm install
cp .env.example .env  # adjust DATABASE_URL
pnpm prisma migrate dev
pnpm prisma db seed
pnpm start:dev
```

## Tests

```bash
pnpm test:unit
pnpm test:integration   # uses Testcontainers; needs Docker
```

## Architecture

See `docs/superpowers/specs/2026-04-28-library-reservation-design.md` for the full design contract.

The 5 business rules are enforced at the layers documented in `docs/business-rules.md`.

## Deploy

GitHub Actions OIDC → ECR → ECS Fargate → RDS. See `docs/aws-setup.md` for the one-time infra setup.
```

- [ ] **Step 2: Write `docs/business-rules.md`**

```markdown
# Business rules and where they are enforced

| # | Rule | Enforced in | Test |
|---|------|-------------|------|
| R1 | Reservation requires user, book, reservedAt, dueDate; dueDate > reservedAt | DTO `CreateReservationInput` (class-validator) + `ReservationsService.create` | `reservations.service.spec.ts` "creates a reservation when copies are available" |
| R2 | A copy cannot have more than one active reservation | DB partial unique index `reservation_active_per_copy` + service pre-check | `reservations.service.spec.ts` "rejects when no copies are available" + concurrency e2e |
| R3 | A book may be returned before dueDate | Service `returnBook` only checks `status=ACTIVE` | `reservations.service.spec.ts` "returnBook before dueDate succeeds" |
| R4 | A user may have at most 3 active reservations simultaneously | Service `count(active) < 3` | `reservations.service.spec.ts` "rejects 4th active reservation per user" |
| R5 | Reservation queries must support date filters | Resolver args `from`, `to` → `reservedAt BETWEEN` | `reservations.service.spec.ts` "myReservations filters by date range" |
```

- [ ] **Step 3: Write `docs/aws-setup.md`**

```markdown
# AWS one-time infrastructure setup

This documents the manual provisioning. Replace `<account>` and `<region>` placeholders.

## 1. ECR repository

```bash
aws ecr create-repository --repository-name nex-books-back --region <region>
```

## 2. RDS Postgres (private subnets)

- Engine: PostgreSQL 16, db.t4g.micro, 20GB gp3
- VPC: default; private subnets, no public access
- Security group: ingress from ECS task SG only
- Database name: `nex_books`, master user: `nex`
- Save the connection string as `nex/prod/db` in Secrets Manager:

```bash
aws secretsmanager create-secret --name nex/prod/db --secret-string '{"DATABASE_URL":"postgresql://nex:<pwd>@<endpoint>:5432/nex_books"}'
```

## 3. JWT secret

```bash
openssl rand -base64 48 | aws secretsmanager create-secret --name nex/prod/jwt --secret-string file:///dev/stdin
```

## 4. ECS cluster + task definition

- Cluster name: `nex-cluster`, Fargate
- Task: 0.25 vCPU, 0.5 GB RAM
- Container port 4000
- Inject secrets as env from `nex/prod/db.DATABASE_URL` and `nex/prod/jwt`
- Log group: `/ecs/nex-books-back`
- Health check: `CMD-SHELL`, `wget -qO- http://localhost:4000/health || exit 1`

(Use the JSON template at `task-definitions/api.json` to register.)

## 5. ALB

- Public, 2 AZs, HTTPS listener with ACM cert
- Target group → ECS service on port 4000
- HTTP listener → redirect 301 to HTTPS

## 6. ECS service

```bash
aws ecs create-service --cluster nex-cluster --service-name nex-books-api \
  --task-definition nex-books-back --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...]}" \
  --load-balancers "targetGroupArn=...,containerName=api,containerPort=4000"
```

## 7. GitHub Actions OIDC role

Create IAM role `gh-actions-deploy` with trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<org>/nex-books-reservation-back:ref:refs/heads/main" }
    }
  }]
}
```

Permissions: `AmazonEC2ContainerRegistryPowerUser`, `AmazonECS_FullAccess`, plus an inline policy allowing `iam:PassRole` on the task role and `ecs:RunTask` on the migrate task.

## 8. CloudWatch alarms

- 5xx > 1% over 5 minutes → SNS notification
- CPU > 80% over 5 minutes → notification
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/business-rules.md docs/aws-setup.md
git commit -m "docs: README + business rules + AWS setup"
```

---

## Task 24: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-back.yml`, `task-definitions/api.json`, `task-definitions/migrate.json`

- [ ] **Step 1: Write task definitions (templates)**

`task-definitions/api.json` — register once via `aws ecs register-task-definition --cli-input-json file://task-definitions/api.json`. The GHA step uses this file to bump the image and re-register.

```json
{
  "family": "nex-books-back",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::<account>:role/nex-books-task-role",
  "containerDefinitions": [{
    "name": "api",
    "image": "<account>.dkr.ecr.<region>.amazonaws.com/nex-books-back:placeholder",
    "essential": true,
    "portMappings": [{ "containerPort": 4000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "4000" },
      { "name": "JWT_EXPIRES_IN", "value": "1h" },
      { "name": "CORS_ORIGIN", "value": "https://<vercel-domain>" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:nex/prod/db:DATABASE_URL::" },
      { "name": "JWT_SECRET",   "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:nex/prod/jwt::" }
    ],
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -qO- http://localhost:4000/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 30
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/nex-books-back",
        "awslogs-region": "<region>",
        "awslogs-stream-prefix": "api"
      }
    }
  }]
}
```

`task-definitions/migrate.json` — same shape, but `command: ["sh","-c","pnpm prisma migrate deploy"]`. Image will be replaced by GHA same way.

- [ ] **Step 2: Write workflow**

`.github/workflows/deploy-back.yml`:

```yaml
name: deploy-back
on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'prisma/**'
      - 'Dockerfile'
      - 'package.json'
      - 'pnpm-lock.yaml'
      - 'task-definitions/**'

env:
  AWS_REGION: <region>
  ECR_REPOSITORY: nex-books-back
  ECS_CLUSTER: nex-cluster
  ECS_SERVICE: nex-books-api

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: test, POSTGRES_DB: test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/test }
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:unit
      - run: pnpm test:integration -- --runInBand
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/test, JWT_SECRET: test-secret-of-at-least-32-characters-long-x }

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions: { id-token: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<account>:role/gh-actions-deploy
          aws-region: ${{ env.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - name: Build & push image
        run: |
          IMAGE=${{ steps.ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ github.sha }}
          docker build -t $IMAGE -t ${{ steps.ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest .
          docker push $IMAGE
          docker push ${{ steps.ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest
          echo "IMAGE=$IMAGE" >> $GITHUB_ENV
      - name: Render migrate task definition
        id: rmig
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definitions/migrate.json
          container-name: api
          image: ${{ env.IMAGE }}
      - name: Run migrations (one-off)
        run: |
          aws ecs register-task-definition --cli-input-json file://${{ steps.rmig.outputs.task-definition }}
          TASK_ARN=$(aws ecs run-task --cluster ${{ env.ECS_CLUSTER }} --launch-type FARGATE \
            --task-definition nex-books-back-migrate \
            --network-configuration "awsvpcConfiguration={subnets=[<subnets>],securityGroups=[<sg>]}" \
            --query 'tasks[0].taskArn' --output text)
          aws ecs wait tasks-stopped --cluster ${{ env.ECS_CLUSTER }} --tasks $TASK_ARN
          EXIT=$(aws ecs describe-tasks --cluster ${{ env.ECS_CLUSTER }} --tasks $TASK_ARN --query 'tasks[0].containers[0].exitCode' --output text)
          if [ "$EXIT" != "0" ]; then echo "Migration failed (exit $EXIT)"; exit 1; fi
      - name: Render API task definition
        id: rapi
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definitions/api.json
          container-name: api
          image: ${{ env.IMAGE }}
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.rapi.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
```

Replace `<account>`, `<region>`, `<subnets>`, `<sg>` with the actual values from the AWS setup.

- [ ] **Step 3: Commit**

```bash
git add .github task-definitions
git commit -m "ci: github actions deploy via OIDC to ECS"
```

---

## Task 25: Final verification

- [ ] **Step 1: Run full test suite locally**

```bash
pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration
```

All green.

- [ ] **Step 2: Boot stack via docker-compose, hit GraphQL**

```bash
docker compose up --build -d
sleep 15
curl -s -X POST http://localhost:4000/graphql -H "Content-Type: application/json" \
  -d '{"query":"mutation{ login(input:{email:\"admin@nex.test\",password:\"Admin123!\"}){ accessToken user{ role } } }"}'
docker compose down
```

Expect a JWT token in the response.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```

GHA deploy workflow runs (assuming infra was provisioned per `docs/aws-setup.md`). Watch in GitHub Actions UI.

- [ ] **Step 4: Confirm production health**

```bash
curl https://<api-domain>/health
```

Expect `{"status":"ok"}`.

---

## Spec coverage checklist

| Spec section | Tasks |
|--------------|-------|
| §3 Domain model | T3 |
| §4 Business rules R1-R5 | T12, T13, T14 |
| §5 Module structure | T4–T18 |
| §6 GraphQL schema | T8, T10, T11, T15, T16 |
| §7 Auth flow | T7, T9, T10 |
| §8 Reservation creation | T12 |
| §9 Return flow | T12 + T13 |
| §10 Errors & codes | T5, T7, T11, T12 |
| §11 Testing | T6, T7, T11, T12, T13, T14, T17 |
| §12 Seeders | T20 |
| §13 Docker & local dev | T21, T22 |
| §14 Env vars | T2 |
| §15 AWS infrastructure | T23 (docs), T24 (CI) |
| §16 CI/CD | T24 |
| §17 Observability | T18 |
| §18 Security checklist | T7, T19 |
| §20 Open items | README in T23 |

---

## Execution mode

After this plan is committed:

1. **Subagent-driven (recommended)** — fresh subagent per task with two-stage review.
2. **Inline execution** — execute tasks in this session via `superpowers:executing-plans`.
