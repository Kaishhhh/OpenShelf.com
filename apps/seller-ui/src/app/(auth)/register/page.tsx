'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import {
  COUNTRIES,
  sellerRegisterSchema,
  type SellerRegisterInput,
} from '@openshelf/types';
import { Button, FormField, Input, Select } from '@openshelf/ui';
import { ApiError, registerSeller } from '@/lib/api';
import { applyServerError } from '@/lib/form-errors';

const FIELDS = [
  'name',
  'email',
  'password',
  'phoneNumber',
  'country',
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SellerRegisterInput>({
    resolver: zodResolver(sellerRegisterSchema),
  });

  const mutation = useMutation<
    { message: string },
    ApiError,
    SellerRegisterInput
  >({
    mutationFn: registerSeller,
    onSuccess: (_, variables) => {
      // The OTP is bound to the email, and /verify has no other way to know it.
      router.push(`/verify?email=${encodeURIComponent(variables.email)}`);
    },
    onError: (error) => applyServerError(error, setError, FIELDS),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-ink">Create a seller account</h1>
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
        <FormField
          label="Phone number"
          htmlFor="phoneNumber"
          error={errors.phoneNumber?.message}
        >
          <Input
            id="phoneNumber"
            type="tel"
            autoComplete="tel"
            {...register('phoneNumber')}
          />
        </FormField>
        <FormField
          label="Country"
          htmlFor="country"
          error={errors.country?.message}
        >
          {/* Codes are the values; names are only ever shown. The empty option
              is disabled so nothing is silently pre-selected. */}
          <Select
            id="country"
            autoComplete="country"
            defaultValue=""
            {...register('country')}
          >
            <option value="" disabled>
              Select a country
            </option>
            {COUNTRIES.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
        {errors.root?.server && (
          <p className="text-xs text-danger">{errors.root.server.message}</p>
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
