import { loginUrl, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps an ordinary path', () => {
    expect(safeReturnTo('/cart')).toBe('/cart');
    expect(safeReturnTo('/products/some-slug')).toBe('/products/some-slug');
  });

  it('keeps a path with a query string', () => {
    expect(safeReturnTo('/products?category=Books')).toBe(
      '/products?category=Books'
    );
  });

  it('falls back to the landing page when absent', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo('')).toBe('/');
  });

  // The reason this function exists: returnTo comes from the URL, so an unchecked
  // value would send a just-authenticated user to an attacker's site.
  it('rejects an absolute URL', () => {
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('http://evil.example')).toBe('/');
  });

  it('rejects a protocol-relative URL despite its leading slash', () => {
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example/path')).toBe('/');
  });

  it('rejects the backslash variant browsers also resolve off-origin', () => {
    expect(safeReturnTo('/\\evil.example')).toBe('/');
  });

  it('rejects a scheme that is not a path at all', () => {
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
    expect(safeReturnTo('data:text/html,hi')).toBe('/');
  });
});

describe('loginUrl', () => {
  it('encodes the path so it survives as one parameter', () => {
    expect(loginUrl('/products/a-b')).toBe('/login?returnTo=%2Fproducts%2Fa-b');
  });

  it('encodes a query string rather than letting it split the URL', () => {
    const url = loginUrl('/products?category=Home & Garden');
    expect(url).not.toContain('&category');
    expect(
      new URLSearchParams(url.split('?')[1]).get('returnTo')
    ).toBe('/products?category=Home & Garden');
  });
});
