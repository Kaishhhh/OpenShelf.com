'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@openshelf/types';
import { Button, FormField, Input } from '@openshelf/ui';
import { ApiError, loginSeller, type SellerSummary } from '@/lib/api';
import { applyServerError } from '@/lib/form-errors';

const FIELDS = ['email', 'password'] as const;

export default function LoginPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const mutation = useMutation<SellerSummary, ApiError, LoginInput>({
    mutationFn: loginSeller,
    onSuccess: () => {
      router.push('/dashboard');
    },
    // 401 (invalid credentials, unverified email) and 429 (lockout) have no
    // field to attach to, so they land in the banner with the server's wording.
    onError: (error) => applyServerError(error, setError, FIELDS),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-ink">Log in</h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        noValidate
      >
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </FormField>
        {errors.root?.server && (
          <p className="text-xs text-danger">{errors.root.server.message}</p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Need a seller account?{' '}
        <a href="/register" className="text-accent">
          Register
        </a>
      </p>
    </div>
  );
}
