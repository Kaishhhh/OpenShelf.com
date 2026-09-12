'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { verifyOtpSchema, type VerifyOtpInput } from '@openshelf/types';
import { Button, FormField, Input, useCountdown } from '@openshelf/ui';
import { ApiError, resendOtp, verifyOtp } from '@/lib/api';
import { applyServerError } from '@/lib/form-errors';

const FIELDS = ['email', 'otp'] as const;

/** Matches COOLDOWN_TTL_SECONDS in @openshelf/auth. */
const RESEND_COOLDOWN_SECONDS = 60;

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<VerifyOtpInput>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { email, otp: '' },
  });

  const mutation = useMutation<{ message: string }, ApiError, VerifyOtpInput>({
    mutationFn: verifyOtp,
    // verify-otp does not log the seller in or set cookies — it only creates
    // the row, so the next step is a normal login.
    onSuccess: () => {
      router.push('/login');
    },
    onError: (error) => applyServerError(error, setError, FIELDS),
  });

  // Arriving here from /register means a code was just sent, so the server's cooldown
  // is already running — start held shut rather than offering a resend that would be
  // silently swallowed.
  const { secondsLeft, restart } = useCountdown(RESEND_COOLDOWN_SECONDS);

  const resend = useMutation<{ message: string }, ApiError, string>({
    mutationFn: (address: string) => resendOtp({ email: address }),
    onSuccess: () => restart(),
  });

  if (!email) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-base font-semibold text-ink">Verify your email</h1>
        <p className="text-sm text-ink-muted">
          This link is missing an email address.
        </p>
        <p className="text-xs text-ink-muted">
          <a href="/register" className="text-accent">
            Back to register
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-ink">Verify your email</h1>
      <p className="text-sm text-ink-muted">
        Enter the 6-digit code sent to {email}
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={handleSubmit((data) => mutation.mutate({ ...data, email }))}
        noValidate
      >
        <input type="hidden" value={email} {...register('email')} />
        <FormField
          label="Verification code"
          htmlFor="otp"
          error={errors.otp?.message}
        >
          <Input
            id="otp"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            {...register('otp')}
          />
        </FormField>
        {errors.root?.server && (
          <p className="text-xs text-danger">{errors.root.server.message}</p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="secondary"
          disabled={secondsLeft > 0 || resend.isPending}
          onClick={() => resend.mutate(email)}
        >
          {resend.isPending
            ? 'Sending…'
            : secondsLeft > 0
            ? `Resend code in ${secondsLeft}s`
            : 'Resend code'}
        </Button>
        {resend.isSuccess && secondsLeft > 0 && (
          <p className="text-xs text-ink-muted">
            If that address is still awaiting verification, a new code is on its way.
          </p>
        )}
        {resend.isError && (
          <p className="text-xs text-danger">{resend.error.message}</p>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary or the Next build fails on the
  // client-side-rendering bailout.
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
