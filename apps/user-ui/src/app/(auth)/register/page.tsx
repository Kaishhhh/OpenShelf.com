'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { registerSchema, type RegisterInput } from '@openshelf/types';
import { Button, FormField, Input } from '@openshelf/ui';
import { ApiError, registerUser } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const mutation = useMutation<{ message: string }, ApiError, RegisterInput>({
    mutationFn: registerUser,
    onSuccess: (_, variables) => {
      router.push(`/verify?email=${encodeURIComponent(variables.email)}`);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-ink">Create account</h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        noValidate
      >
        <FormField label="Name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" {...register('name')} />
        </FormField>
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
            autoComplete="new-password"
            {...register('password')}
          />
        </FormField>
        {mutation.isError && (
          <p className="text-xs text-danger">{mutation.error.message}</p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Already have an account?{' '}
        <a href="/login" className="text-accent">
          Log in
        </a>
      </p>
    </div>
  );
}
