import { describe, it, expect, beforeEach } from 'vitest';

describe('encrypt / decrypt', () => {
  beforeEach(() => {
    // Set a valid 32-byte hex key for tests
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('round-trips a string', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto.js');
    const original = '{"access_token":"abc","refresh_token":"xyz"}';
    const ciphertext = encrypt(original);
    expect(ciphertext).not.toBe(original);
    expect(decrypt(ciphertext)).toBe(original);
  });

  it('produces different ciphertexts for same input (random IV)', async () => {
    const { encrypt } = await import('../../src/lib/crypto.js');
    const c1 = encrypt('hello');
    const c2 = encrypt('hello');
    expect(c1).not.toBe(c2);
  });

  it('throws on invalid key length', async () => {
    process.env.ENCRYPTION_KEY = 'short';
    const { encrypt } = await import('../../src/lib/crypto.js');
    expect(() => encrypt('hello')).toThrow('ENCRYPTION_KEY');
  });
});
