'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@openshelf/types';
import { Button, FormField, Input } from '@openshelf/ui';
import { ApiError, loginUser } from '@/lib/api';
import { safeReturnTo } from '@/lib/return-to';
import { CART_KEY } from '@/lib/use-cart';
import { NOTIFICATIONS_KEY } from '@/lib/realtime';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Validated rather than used as given: an unchecked returnTo would turn this page
  // into an open redirect. See safeReturnTo.
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const mutation = useMutation<
    { id: string; name: string; email: string },
    ApiError,
    LoginInput
  >({
    mutationFn: loginUser,
    onSuccess: () => {
      // The cart was fetched as anonymous before this point, and that 401 is cached.
      // Without this the header badge stays empty until something else invalidates it.
      queryClient.invalidateQueries({ queryKey: CART_KEY });
      // Same for notifications — and their data is what connects the socket.
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      router.push(returnTo);
    },
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
        {mutation.isError && (
          <p className="text-xs text-danger">{mutation.error.message}</p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Need an account?{' '}
        <a href="/register" className="text-accent">
          Register
        </a>
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary above it — the same trap /verify
  // already works around.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
