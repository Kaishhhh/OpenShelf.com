import { NotFoundError } from '@openshelf/errors';
import { parseObjectId, randomSlugSuffix, slugify } from './product.helper.js';

describe('slugify', () => {
  it.each([
    ['Ceramic Mug', 'ceramic-mug'],
    ['  Trimmed  Spaces  ', 'trimmed-spaces'],
    ['Crème Brûlée', 'creme-brulee'],
    ['Hello, World! (v2)', 'hello-world-v2'],
    ['MiXeD CaSe', 'mixed-case'],
    ['multiple---dashes', 'multiple-dashes'],
    ['---leading and trailing---', 'leading-and-trailing'],
    ['Product #1 & #2', 'product-1-2'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('falls back to "product" when nothing survives the transform', () => {
    expect(slugify('陶器のマグカップ')).toBe('product');
    expect(slugify('🎉🎉🎉')).toBe('product');
  });

  it('truncates long titles without leaving a trailing dash', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('randomSlugSuffix', () => {
  it('returns a short alphanumeric string', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{1,6}$/);
    }
  });
});

describe('parseObjectId', () => {
  it('accepts a 24-character hex id', () => {
    expect(parseObjectId('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaa'
    );
  });

  // A malformed id must not reach Prisma (P2023 -> 500) and must not be
  // distinguishable from someone else's id.
  it.each([['too-short'], [''], ['g'.repeat(24)], ['a'.repeat(25)]])(
    'rejects %p with NotFoundError',
    (bad) => {
      expect(() => parseObjectId(bad)).toThrow(NotFoundError);
    }
  );

  it('rejects undefined', () => {
    expect(() => parseObjectId(undefined)).toThrow(NotFoundError);
  });
});
