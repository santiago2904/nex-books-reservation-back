import request from 'supertest';
import { setupTestApp, teardownTestApp, TestContext } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';

const REGISTER = `
  mutation Register($i: RegisterInput!) {
    register(input: $i) { accessToken user { id email role } }
  }
`;
const LOGIN = `
  mutation Login($i: LoginInput!) {
    login(input: $i) { accessToken user { role } }
  }
`;
const CREATE_BOOK = `
  mutation CreateBook($i: CreateBookInput!) {
    createBook(input: $i) { id copies { id status } }
  }
`;
const RESERVE = `
  mutation Reserve($i: CreateReservationInput!) {
    createReservation(input: $i) { id status bookCopy { code book { title } } }
  }
`;
const RETURN = `
  mutation Return($id: ID!) {
    returnBook(reservationId: $id) { id status returnedAt }
  }
`;
const MY = `
  query Mine { myReservations { id status } }
`;
const BOOKS = `query { books { id title availableCopies } }`;

describe('Auth + reservation E2E (GraphQL via HTTP)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(() => cleanupDb(ctx.prisma));

  async function gql(
    query: string,
    variables: Record<string, unknown> = {},
    token?: string,
  ) {
    const req = request(ctx.app.getHttpServer()).post('/graphql');
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.send({ query, variables });
    return res.body as { data?: any; errors?: any[] };
  }

  it('happy path: register → admin creates book → user reserves → return', async () => {
    // 1. Register an admin (we elevate by direct DB update — register defaults to USER)
    const adminReg = await gql(REGISTER, {
      i: { name: 'Admin', email: 'admin@nex.test', password: 'Admin123!' },
    });
    expect(adminReg.errors).toBeUndefined();
    await ctx.prisma.user.update({
      where: { email: 'admin@nex.test' },
      data: { role: 'ADMIN' },
    });
    // Re-login to get a token with the new role embedded
    const adminLogin = await gql(LOGIN, {
      i: { email: 'admin@nex.test', password: 'Admin123!' },
    });
    const adminToken = adminLogin.data.login.accessToken;
    expect(adminLogin.data.login.user.role).toBe('ADMIN');

    // 2. Admin creates a book with 1 copy
    const cb = await gql(
      CREATE_BOOK,
      { i: { title: 'Sapiens', author: 'Harari', initialCopies: 1 } },
      adminToken,
    );
    expect(cb.errors).toBeUndefined();
    const bookId = cb.data.createBook.id;
    expect(cb.data.createBook.copies).toHaveLength(1);

    // 3. Register a regular user
    const userReg = await gql(REGISTER, {
      i: { name: 'Bob', email: 'bob@nex.test', password: 'User1234!' },
    });
    const userToken = userReg.data.register.accessToken;

    // 4. User reserves the book
    const dueDate = new Date(Date.now() + 86_400_000).toISOString();
    const rv = await gql(
      RESERVE,
      { i: { bookId, dueDate } },
      userToken,
    );
    expect(rv.errors).toBeUndefined();
    expect(rv.data.createReservation.status).toBe('ACTIVE');
    expect(rv.data.createReservation.bookCopy.book.title).toBe('Sapiens');
    const reservationId = rv.data.createReservation.id;

    // 5. myReservations shows it
    const my = await gql(MY, {}, userToken);
    expect(my.data.myReservations).toHaveLength(1);

    // 6. Books list shows availableCopies = 0
    const list = await gql(BOOKS);
    const sapiens = list.data.books.find((b: any) => b.title === 'Sapiens');
    expect(sapiens.availableCopies).toBe(0);

    // 7. Return
    const ret = await gql(RETURN, { id: reservationId }, userToken);
    expect(ret.errors).toBeUndefined();
    expect(ret.data.returnBook.status).toBe('RETURNED');
    expect(ret.data.returnBook.returnedAt).not.toBeNull();

    // 8. Books list now shows availableCopies = 1 again
    const list2 = await gql(BOOKS);
    const sapiens2 = list2.data.books.find((b: any) => b.title === 'Sapiens');
    expect(sapiens2.availableCopies).toBe(1);
  });

  it('blocks unauthenticated reservation', async () => {
    const dueDate = new Date(Date.now() + 86_400_000).toISOString();
    const res = await gql(RESERVE, {
      i: { bookId: '00000000-0000-0000-0000-000000000000', dueDate },
    });
    expect(res.errors).toBeDefined();
    expect(res.errors[0].extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('blocks USER from creating a book (admin-only mutation)', async () => {
    const reg = await gql(REGISTER, {
      i: { name: 'User', email: 'user@nex.test', password: 'User1234!' },
    });
    const token = reg.data.register.accessToken;
    const res = await gql(
      CREATE_BOOK,
      { i: { title: 'X', author: 'Y', initialCopies: 1 } },
      token,
    );
    expect(res.errors).toBeDefined();
    expect(res.errors[0].extensions?.code).toBe('FORBIDDEN');
  });
});
