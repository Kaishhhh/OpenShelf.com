import { ApiError } from './api';
import { applyServerError } from './form-errors';

const FIELDS = ['email', 'password', 'country'] as const;
type Fields = Record<(typeof FIELDS)[number], string>;

function collect() {
  const calls: { name: string; message?: string }[] = [];
  const setError = ((name: string, opts: { message?: string }) => {
    calls.push({ name, message: opts.message });
  }) as never;
  return { calls, setError };
}

describe('applyServerError', () => {
  it('attaches a 400 issue to the field it names', () => {
    const { calls, setError } = collect();
    const error = new ApiError('Invalid request data', 400, [
      { path: ['country'], message: 'Select a valid country' },
    ]);

    applyServerError<Fields>(error, setError, FIELDS);

    expect(calls).toEqual([
      { name: 'country', message: 'Select a valid country' },
    ]);
  });

  it('attaches every issue when a 400 names several fields', () => {
    const { calls, setError } = collect();
    const error = new ApiError('Invalid request data', 400, [
      { path: ['email'], message: 'Invalid email address' },
      { path: ['password'], message: 'Password must be at least 8 characters' },
    ]);

    applyServerError<Fields>(error, setError, FIELDS);

    expect(calls.map((c) => c.name)).toEqual(['email', 'password']);
  });

  // The banner is the only place these can show, so they must not be swallowed.
  it.each([
    [401, 'Invalid credentials'],
    [401, 'Please verify your email before logging in'],
    [429, 'Too many failed attempts, please try again later'],
    [429, 'Please wait before requesting another code'],
  ])('routes a %i to the banner with the server message', (status, message) => {
    const { calls, setError } = collect();

    applyServerError<Fields>(new ApiError(message, status), setError, FIELDS);

    expect(calls).toEqual([{ name: 'root.server', message }]);
  });

  // zod reports a bad array member at ['tags', 3], which would otherwise join
  // to "tags.3" and match nothing.
  it('attaches an array-member issue to the field owning the array', () => {
    const { calls, setError } = collect();
    const error = new ApiError('Invalid request data', 400, [
      { path: ['tags', 3], message: 'Each tag must be at most 30 characters' },
    ]);

    applyServerError<Fields>(error, setError, ['tags'] as never);

    expect(calls).toEqual([
      { name: 'tags', message: 'Each tag must be at most 30 characters' },
    ]);
  });

  it('falls back to the banner when a 400 names no rendered field', () => {
    const { calls, setError } = collect();
    const error = new ApiError('Invalid request data', 400, [
      { path: ['somethingElse'], message: 'Nope' },
    ]);

    applyServerError<Fields>(error, setError, FIELDS);

    expect(calls).toEqual([
      { name: 'root.server', message: 'Invalid request data' },
    ]);
  });

  it('falls back to the banner when a 400 carries no details', () => {
    const { calls, setError } = collect();

    applyServerError<Fields>(
      new ApiError('Invalid request data', 400),
      setError,
      FIELDS
    );

    expect(calls).toEqual([
      { name: 'root.server', message: 'Invalid request data' },
    ]);
  });

  it('survives a non-ApiError rejection', () => {
    const { calls, setError } = collect();

    applyServerError<Fields>(new Error('Failed to fetch'), setError, FIELDS);

    expect(calls).toEqual([
      { name: 'root.server', message: 'Failed to fetch' },
    ]);
  });
});
