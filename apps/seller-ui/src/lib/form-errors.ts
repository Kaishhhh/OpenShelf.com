import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

interface ServerIssue {
  path?: unknown;
  message?: unknown;
}

/**
 * Puts a failed request onto the form.
 *
 * A 400 answers with `"Invalid request data"` plus the zod `issues[]` under
 * `details`; showing only that top-level message would tell the seller
 * something was wrong but not which field, so the issues are attached to the
 * fields they name. Anything else — 401, 429, or a 400 whose issues name no
 * rendered field — goes to `root.server`, which the pages show as a banner.
 *
 * Either way the string displayed is the server's own, never a generic one.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[]
): void {
  const message =
    error instanceof Error ? error.message : 'Something went wrong';

  const issues =
    error instanceof ApiError &&
    error.status === 400 &&
    Array.isArray(error.details)
      ? (error.details as ServerIssue[])
      : [];

  let attached = false;

  for (const issue of issues) {
    if (!Array.isArray(issue.path) || issue.path.length === 0) {
      continue;
    }

    // An issue inside an array arrives as ['tags', 3], which joins to "tags.3"
    // — a name no form renders. Drop trailing index segments so it lands on the
    // field that owns the array.
    const segments = [...issue.path];
    while (
      segments.length > 1 &&
      typeof segments[segments.length - 1] === 'number'
    ) {
      segments.pop();
    }

    const name = segments.join('.') as Path<T>;
    // Only fields this form actually renders; anything else has nowhere to
    // show and is left to the banner.
    if (!fields.includes(name)) {
      continue;
    }

    setError(name, {
      type: 'server',
      message:
        typeof issue.message === 'string' ? issue.message : 'Invalid value',
    });
    attached = true;
  }

  if (!attached) {
    setError('root.server' as Path<T>, { type: 'server', message });
  }
}
