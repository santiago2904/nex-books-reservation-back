import { setupTestApp, teardownTestApp, TestContext } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { expectRejectsWithCode } from '../helpers/expect-code';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService', () => {
  let ctx: TestContext;
  let svc: AuthService;

  beforeAll(async () => {
    ctx = await setupTestApp();
    svc = ctx.app.get(AuthService);
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(() => cleanupDb(ctx.prisma));

  describe('register', () => {
    it('hashes the password and returns a JWT + user', async () => {
      const result = await svc.register({
        name: 'Ana',
        email: 'ana@nex.test',
        password: 'Pass1234!',
      });
      expect(result.accessToken).toMatch(/^eyJ/);
      expect(result.user.email).toBe('ana@nex.test');
      expect(result.user.role).toBe('USER');

      const stored = await ctx.prisma.user.findUnique({
        where: { email: 'ana@nex.test' },
      });
      expect(stored?.passwordHash).not.toBe('Pass1234!');
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('rejects duplicate emails with EMAIL_ALREADY_EXISTS', async () => {
      await svc.register({
        name: 'Ana',
        email: 'ana@nex.test',
        password: 'Pass1234!',
      });
      await expectRejectsWithCode(
        svc.register({
          name: 'Ana 2',
          email: 'ana@nex.test',
          password: 'Pass1234!',
        }),
        'EMAIL_ALREADY_EXISTS',
      );
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      await svc.register({
        name: 'Ana',
        email: 'ana@nex.test',
        password: 'Pass1234!',
      });
      const result = await svc.login('ana@nex.test', 'Pass1234!');
      expect(result.accessToken).toMatch(/^eyJ/);
      expect(result.user.email).toBe('ana@nex.test');
    });

    it('rejects wrong password with INVALID_CREDENTIALS', async () => {
      await svc.register({
        name: 'Ana',
        email: 'ana@nex.test',
        password: 'Pass1234!',
      });
      await expectRejectsWithCode(
        svc.login('ana@nex.test', 'wrong-pass'),
        'INVALID_CREDENTIALS',
      );
    });

    it('rejects unknown email with INVALID_CREDENTIALS', async () => {
      await expectRejectsWithCode(
        svc.login('nobody@nex.test', 'Pass1234!'),
        'INVALID_CREDENTIALS',
      );
    });
  });
});
