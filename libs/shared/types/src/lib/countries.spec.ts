import { COUNTRIES, COUNTRY_CODES } from './countries.js';
import { sellerRegisterSchema } from './auth.schemas.js';

describe('COUNTRIES', () => {
  it('holds the 249 officially assigned alpha-2 codes', () => {
    expect(COUNTRIES).toHaveLength(249);
  });

  it('has no duplicate codes', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it('is all two uppercase letters', () => {
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('gives every code a non-empty display name', () => {
    for (const { name } of COUNTRIES) {
      expect(name.trim()).not.toBe('');
    }
  });
});

describe('sellerRegisterSchema.country', () => {
  const base = {
    name: 'Test Seller',
    email: 'seller@example.com',
    password: 'password123',
    phoneNumber: '+6580000000',
  };

  it('accepts an alpha-2 code', () => {
    const result = sellerRegisterSchema.safeParse({ ...base, country: 'SG' });
    expect(result.success).toBe(true);
  });

  // The three spellings that used to be three distinct countries.
  it.each(['Singapore', 'singapore', 'sg'])('rejects %p', (country) => {
    const result = sellerRegisterSchema.safeParse({ ...base, country });
    expect(result.success).toBe(false);
  });

  it('rejects an empty country', () => {
    const result = sellerRegisterSchema.safeParse({ ...base, country: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a well-formed code that is not assigned', () => {
    const result = sellerRegisterSchema.safeParse({ ...base, country: 'ZZ' });
    expect(result.success).toBe(false);
  });

  it('reports the field so a form can attach the error to it', () => {
    const result = sellerRegisterSchema.safeParse({ ...base, country: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['country']);
    }
  });
});
