// @openshelf/auth and @openshelf/middleware throw at import without these. Specs import
// them transitively, and imports are hoisted above anything a spec file could set first.
// Test-only values; a real environment always provides its own.
process.env.ACCESS_TOKEN_SECRET ??= 'access-secret-for-tests';
process.env.REFRESH_TOKEN_SECRET ??= 'refresh-secret-for-tests';
