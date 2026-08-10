'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@openshelf/types';
import { Button, FormField, Input } from '@openshelf/ui';
import { ApiError, loginUser } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
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
      router.push('/');
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
