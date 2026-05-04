# Nex Books Reservation — Backend

API REST/GraphQL para gestión de reservas de libros de biblioteca. Construida con NestJS 11, GraphQL (Apollo Server 4), Prisma ORM y PostgreSQL. Autenticación JWT con roles `USER` / `ADMIN`, modelo de múltiples ejemplares por libro y reservas seguras ante condiciones de carrera.

> **Repo frontend:** [`nex-books-reservation-front`](https://github.com/santiago2904/nex-books-reservation-front)

---

## Stack

| Tecnología | Versión | Rol |
|---|---|---|
| NestJS | 11 | Framework Node.js |
| GraphQL (code-first) | Apollo Server 4 | API principal |
| Prisma ORM | 5 | Capa de base de datos |
| PostgreSQL | 16 | Base de datos relacional |
| JWT (`@nestjs/jwt`) | — | Autenticación stateless |
| Passport (`passport-jwt`) | — | Estrategia JWT |
| bcryptjs | — | Hash de contraseñas |
| class-validator | — | Validación de DTOs |
| Zod | — | Validación de variables de entorno en boot |
| Jest + Testcontainers | — | Pruebas unitarias e integración |

---

## Funcionalidades

### Autenticación
- `register` / `login` — emiten JWT (HS256, exp 1h)
- Guards globales (`GqlAuthGuard` + `RolesGuard`) — todo protegido por defecto; `@Public()` expone endpoints públicos
- Roles: `USER` y `ADMIN`

### Libros (`ADMIN`)
- CRUD completo de títulos con campo `coverUrl` opcional
- Gestión de ejemplares físicos: `addBookCopy` / `removeBookCopy`
- `deleteBook` bloqueado si existen reservas activas

### Reservas
- `createReservation` — reserva un ejemplar con idempotency key
- `returnBook` — devuelve el ejemplar (antes o después de la fecha de vencimiento)
- `myReservations` — reservas del usuario autenticado con filtros de fecha
- `reservationsByBook` / `reservationsByUser` — vistas admin con filtros
- `allReservations` — todas las reservas con búsqueda full-text y filtros (solo ADMIN)

### Reglas de negocio
| Regla | Enforcement |
|---|---|
| R1: reserva requiere usuario, libro y `dueDate > now` | DTO + servicio |
| R2: máximo una reserva activa por ejemplar | Índice parcial único en DB + retry en `P2002` |
| R3: devolución antes de la fecha de vencimiento permitida | `returnBook` solo verifica `status = ACTIVE` |
| R4: máximo 3 reservas activas por usuario | Conteo antes del insert |
| R5: consultas de reservas con filtro por fecha | Args `from` / `to` en todos los resolvers |

---

## Producción (AWS)

| Endpoint | URL |
|---|---|
| **API GraphQL** | `https://d3uqn5vjvaiydr.cloudfront.net/graphql` |
| **Health** | `https://d3uqn5vjvaiydr.cloudfront.net/health` |

Stack: ECS Fargate + RDS PostgreSQL 16 + ALB + CloudFront (HTTPS). CI/CD via GitHub Actions OIDC. Documentación completa de la infra en [`docs/aws-infrastructure.md`](docs/aws-infrastructure.md).

---

## Quickstart

### Con Docker (recomendado — un solo comando)

```bash
docker compose up --build
```

Levanta: **API** en `:4000` · **PostgreSQL** en `:5433` · **Adminer** en `:8080`

Migraciones y seeds se aplican automáticamente al boot.

### Sin Docker

```bash
pnpm install
cp .env.example .env      # configurar DATABASE_URL
pnpm prisma:deploy        # aplicar migraciones
pnpm prisma:seed          # cargar datos de prueba
pnpm start:dev            # http://localhost:4000/graphql
```

Requiere PostgreSQL corriendo y accesible vía `DATABASE_URL`.

---

## Variables de entorno

| Variable | Default (dev) | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgresql://nex:nex@localhost:5433/nex_books` | Conexión a PostgreSQL |
| `JWT_SECRET` | *(dev secret)* | Clave de firma JWT — mínimo 32 bytes en producción |
| `JWT_EXPIRES_IN` | `1h` | Expiración del token |
| `PORT` | `4000` | Puerto de la API |
| `CORS_ORIGIN` | `http://localhost:5173` | Origen permitido (separados por coma) |
| `NODE_ENV` | `development` | Entorno |

El boot falla intencionalmente si `JWT_SECRET` es menor de 32 caracteres o `DATABASE_URL` es inválido.

---

## Cuentas de prueba (seed)

| Email | Contraseña | Rol |
|---|---|---|
| `admin@nex.test` | `Admin123!` | ADMIN |
| `ana@nex.test` | `User1234!` | USER (tiene 1 reserva activa) |
| `bruno@nex.test` | `User1234!` | USER |

15 libros con portadas (Open Library), ~44 ejemplares, 1 reserva activa precargada.

---

## API GraphQL

**Playground:** `http://localhost:4000/graphql`

### Queries públicas
```graphql
books(available: Boolean): [Book!]!
book(id: ID!): Book
```

### Mutations públicas
```graphql
register(input: RegisterInput!): AuthPayload!
login(input: LoginInput!): AuthPayload!
```

### Autenticadas (header: `Authorization: Bearer <token>`)
```graphql
me: User!
createReservation(input: CreateReservationInput!): Reservation!
returnBook(reservationId: ID!): Reservation!
myReservations(filters: ReservationFiltersInput): [Reservation!]!
```

### Solo ADMIN
```graphql
createBook(input: CreateBookInput!): Book!
updateBook(id: ID!, input: UpdateBookInput!): Book!
deleteBook(id: ID!): Boolean!
addBookCopy(bookId: ID!): BookCopy!
removeBookCopy(copyId: ID!): Boolean!
createUser(input: CreateUserInput!): User!
reservationsByBook(bookId: ID!, filters: ReservationFiltersInput): [Reservation!]!
reservationsByUser(userId: ID!, filters: ReservationFiltersInput): [Reservation!]!
allReservations(filters: ReservationFiltersInput): [Reservation!]!
```

---

## Pruebas

```bash
# Unit tests (Testcontainers — requiere Docker)
DATABASE_URL=postgresql://nex:nex@localhost:5433/nex_books pnpm test:unit

# Integration tests (incluye prueba de concurrencia)
DATABASE_URL=postgresql://nex:nex@localhost:5433/nex_books pnpm test:integration
```

**32 pruebas:**

| Suite | Tests | Cubre |
|---|---|---|
| `auth.service.spec.ts` | 5 | Hash de contraseña, JWT, duplicados, credenciales inválidas |
| `books.service.spec.ts` | 6 | CRUD, bloqueo de eliminación con reservas activas, gestión de copias |
| `reservations.service.spec.ts` | 16 | Reglas R1–R5, idempotencia, ownership en devolución |
| `concurrency.spec.ts` | 2 | 10 reservas simultáneas → exactamente 1 gana; M copias, N>M usuarios → M ganan |
| `reservation-flow.e2e.spec.ts` | 3 | Flujo completo HTTP: register → createBook → reserve → return |

**Prueba de concurrencia (R2):**
```
Racing: 10 concurrent reservation attempts…
  fulfilled: 1  ← solo una gana
  rejected:  9  ← las demás reciben NO_COPIES_AVAILABLE
  active reservations in DB: 1 ✅
```

---

## Modelo de datos

```
User          — id, name, email, passwordHash, role, createdAt
Book          — id, title, author, isbn?, description?, coverUrl?, createdAt, updatedAt
BookCopy      — id, bookId, code (unique), status (AVAILABLE|RESERVED|MAINTENANCE)
Reservation   — id, userId, bookCopyId, reservedAt, dueDate, returnedAt?, status, idempotencyKey?
```

**Índice crítico (R2):**
```sql
CREATE UNIQUE INDEX "reservation_active_per_copy"
  ON "Reservation" ("bookCopyId")
  WHERE status = 'ACTIVE';
```
Garantiza a nivel de base de datos que un ejemplar no pueda tener dos reservas activas simultáneas, incluso bajo carga concurrente.

---

## Decisiones técnicas

**Concurrencia (R2):** En vez de pessimistic locking, se usa un índice parcial único en PostgreSQL. El servicio intenta el INSERT hasta 3 veces ante una violación `P2002` — busca el siguiente ejemplar disponible. El test de concurrencia prueba 10 goroutines en paralelo y verifica que exactamente 1 gana.

**Idempotencia:** `createReservation` acepta un `idempotencyKey` opcional. El par `(userId, idempotencyKey)` tiene un `@@unique` en Prisma. Re-enviar la misma key devuelve la reserva existente sin crear una nueva — resuelve el problema de double-click en el cliente.

**Portadas de libros:** Campo `coverUrl?: String` en `Book`. El frontend usa la prioridad: `coverUrl` → Open Library API (`isbn`) → placeholder con iniciales.

**Logout simbólico (v1):** El JWT expira naturalmente en 1h. No hay refresh tokens ni blacklist. Documentado como decisión intencional para v1 por simplicidad.

**GraphQL code-first:** Decoradores NestJS generan el schema automáticamente. `autoSchemaFile` produce `src/schema.gql` en dev.

---

## Colección Postman

`docs/nex-books.postman_collection.json` — importa directamente en Postman.

Incluye todas las queries y mutations organizadas por carpeta. El script del request **Login** guarda el token automáticamente en `{{token}}` para que el resto de requests funcionen sin configuración adicional. Pre-request scripts calculan `dueDate` y generan `idempotencyKey` automáticamente.

---

## Despliegue en AWS (opcional)

Infraestructura documentada paso a paso en [`docs/aws-setup.md`](docs/aws-setup.md):
- ECR → imagen Docker multi-stage
- ECS Fargate + RDS PostgreSQL (privado) + ALB + ACM
- Migraciones como one-off Fargate task antes del deploy
- GitHub Actions con OIDC (sin AWS keys en secrets) en `.github/workflows/deploy-back.yml`
