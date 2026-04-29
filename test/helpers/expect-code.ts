/**
 * Asserts a promise rejects with a Nest HttpException whose response carries
 * the given domain code (e.g. 'MAX_ACTIVE_RESERVATIONS').
 */
export async function expectRejectsWithCode(
  promise: Promise<unknown>,
  code: string,
) {
  await expect(promise).rejects.toMatchObject({
    response: { code },
  });
}
