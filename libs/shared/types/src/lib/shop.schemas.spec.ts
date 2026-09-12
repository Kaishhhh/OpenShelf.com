import { CATEGORIES } from './categories.js';
import { shopCreateSchema, type ShopCreateInput } from './shop.schemas.js';

const base = {
  name: 'Kai Ceramics',
  category: 'Handmade',
  address: '1 Test Street',
};

function parse(input: unknown) {
  return shopCreateSchema.safeParse(input);
}

describe('CATEGORIES', () => {
  it('has no duplicates', () => {
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });

  it('accepts every listed category', () => {
    for (const category of CATEGORIES) {
      expect(parse({ ...base, category }).success).toBe(true);
    }
  });
});

describe('shopCreateSchema.category', () => {
  // The three spellings that used to be three different categories.
  it.each(['Homeware', 'electronics', 'Electronis', ''])(
    'rejects %p',
    (category) => {
      expect(parse({ ...base, category }).success).toBe(false);
    }
  );

  it('reports the field so the form can attach the error to it', () => {
    const result = parse({ ...base, category: 'Nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['category']);
    }
  });
});

// An untouched input in the browser posts "", not undefined.
describe('blank optional fields', () => {
  it('accepts a blank website and stores it as absent', () => {
    const result = parse({ ...base, website: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBeUndefined();
      expect('website' in result.data && result.data.website !== undefined).toBe(
        false
      );
    }
  });

  it('treats whitespace-only text as absent', () => {
    const result = parse({ ...base, bio: '   ', openingHours: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bio).toBeUndefined();
      expect(result.data.openingHours).toBeUndefined();
    }
  });

  it('accepts four blank social links', () => {
    const result = parse({
      ...base,
      socialLinks: { instagram: '', facebook: '', x: '', tiktok: '' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.socialLinks).toEqual({});
    }
  });

  it('keeps a real link while dropping its blank siblings', () => {
    const result = parse({
      ...base,
      socialLinks: { instagram: 'https://instagram.com/kai', facebook: '' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.socialLinks).toEqual({
        instagram: 'https://instagram.com/kai',
      });
    }
  });

  // Blank is tolerated; malformed is still a failure.
  it('still rejects a malformed website', () => {
    const result = parse({ ...base, website: 'not-a-url' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['website']);
    }
  });

  it('still rejects a malformed social link, naming the nested path', () => {
    const result = parse({ ...base, socialLinks: { tiktok: 'nope' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      // form-errors.ts joins this with '.', so it must be socialLinks.tiktok
      expect(result.error.issues[0].path).toEqual(['socialLinks', 'tiktok']);
    }
  });

  it('rejects an unknown social network', () => {
    const result = parse({
      ...base,
      socialLinks: { linkedin: 'https://linkedin.com/x' },
    });
    expect(result.success).toBe(false);
  });
});

describe('shopCreateSchema required fields', () => {
  it.each(['name', 'address'])('requires %s', (field) => {
    const input: Record<string, unknown> = { ...base };
    input[field] = '';
    expect(parse(input).success).toBe(false);
  });

  it('produces a usable ShopCreateInput', () => {
    const result = parse({ ...base, bio: 'Handmade ceramics.' });
    expect(result.success).toBe(true);
    if (result.success) {
      const typed: ShopCreateInput = result.data;
      expect(typed.name).toBe('Kai Ceramics');
      expect(typed.category).toBe('Handmade');
    }
  });
});
