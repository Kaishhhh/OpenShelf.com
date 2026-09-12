import { catalogueQuery } from './api';

describe('catalogueQuery', () => {
  it('is empty when nothing is filtered', () => {
    expect(catalogueQuery({})).toBe('');
  });

  // Filters live in the URL so a view is shareable; a default must not show up
  // there as noise.
  it('omits undefined and empty values', () => {
    expect(
      catalogueQuery({
        category: undefined,
        shopId: '',
        minPrice: undefined,
      })
    ).toBe('');
  });

  it('composes several filters', () => {
    const query = catalogueQuery({
      category: 'Handmade',
      minPrice: 10,
      sort: 'price-asc',
    });
    const params = new URLSearchParams(query.slice(1));

    expect(params.get('category')).toBe('Handmade');
    expect(params.get('minPrice')).toBe('10');
    expect(params.get('sort')).toBe('price-asc');
  });

  it('encodes a category containing an ampersand', () => {
    const query = catalogueQuery({ category: 'Home & Garden' });
    // A bare '&' would split the query string into two params.
    expect(query).not.toContain('Home & Garden');
    expect(new URLSearchParams(query.slice(1)).get('category')).toBe(
      'Home & Garden'
    );
  });

  it('keeps a zero minimum price rather than treating it as absent', () => {
    expect(catalogueQuery({ minPrice: 0 })).toBe('?minPrice=0');
  });
});
