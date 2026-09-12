'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  CATEGORIES,
  shopCreateSchema,
  type ShopCreateInput,
} from '@openshelf/types';
import { Button, FormField, Input, Select, Textarea } from '@openshelf/ui';
import { ApiError, createShop, getShop, type Shop } from '@/lib/api';
import { applyServerError } from '@/lib/form-errors';

// Dotted names because applyServerError joins a zod issue's path with '.', so a
// server complaint about socialLinks.instagram lands on that input.
const FIELDS = [
  'name',
  'category',
  'address',
  'bio',
  'openingHours',
  'website',
  'socialLinks.instagram',
  'socialLinks.facebook',
  'socialLinks.x',
  'socialLinks.tiktok',
] as const;

const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
] as const;

/**
 * Values for the form. A rejected shop is edited rather than retyped, so its
 * current values seed the fields; everything else starts blank.
 *
 * Nulls become empty strings because a controlled input cannot take null, and
 * the schema turns them back into "not provided" on submit.
 */
function defaultsFrom(shop: Shop | undefined): ShopCreateInput {
  return {
    name: shop?.name ?? '',
    // A row predating CATEGORIES holds a value the select cannot show, so
    // it falls back to the placeholder and the seller must pick a valid one.
    category: (shop?.category ?? '') as ShopCreateInput['category'],
    address: shop?.address ?? '',
    bio: shop?.bio ?? '',
    openingHours: shop?.openingHours ?? '',
    website: shop?.website ?? '',
    socialLinks: {
      instagram: shop?.socialLinks?.instagram ?? '',
      facebook: shop?.socialLinks?.facebook ?? '',
      x: shop?.socialLinks?.x ?? '',
      tiktok: shop?.socialLinks?.tiktok ?? '',
    },
  };
}

export default function NewShopPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, error, isPending } = useQuery<Shop, ApiError>({
    queryKey: ['shop'],
    queryFn: getShop,
    // The 404 here means "no shop yet", which is the main reason to be on this
    // page — retrying it would just repeat a correct answer.
    retry: false,
  });

  const unauthenticated = error?.status === 401;
  // A shop that is not rejected must not be edited here; the server would 400.
  const alreadyHasShop = !!data && data.status !== 'REJECTED';

  useEffect(() => {
    if (unauthenticated) {
      router.replace('/login');
    } else if (alreadyHasShop) {
      router.replace('/dashboard');
    }
  }, [unauthenticated, alreadyHasShop, router]);

  const settled = !isPending && !unauthenticated && !alreadyHasShop;

  if (!settled) {
    // Rendering the form before the query settles would capture empty
    // defaultValues and the prefill would never appear.
    return null;
  }

  if (error && error.status !== 404) {
    return (
      <Panel title="Something went wrong">
        <p className="text-sm text-danger">{error.message}</p>
      </Panel>
    );
  }

  return (
    <ShopForm
      existing={data}
      onSaved={() => {
        // The dashboard reads the same key, and it must not show the stale
        // rejected shop after a resubmission.
        queryClient.invalidateQueries({ queryKey: ['shop'] });
        router.push('/dashboard');
      }}
    />
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6">
      <h1 className="text-base font-semibold text-ink">{title}</h1>
      {children && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function ShopForm({
  existing,
  onSaved,
}: {
  existing: Shop | undefined;
  onSaved: () => void;
}) {
  const resubmitting = existing?.status === 'REJECTED';

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ShopCreateInput>({
    resolver: zodResolver(shopCreateSchema),
    defaultValues: defaultsFrom(existing),
  });

  const mutation = useMutation<Shop, ApiError, ShopCreateInput>({
    mutationFn: createShop,
    onSuccess: onSaved,
    onError: (err) => applyServerError(err, setError, FIELDS),
  });

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-card border border-line bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold text-ink">
          {resubmitting ? 'Update your shop' : 'Set up your shop'}
        </h1>
        <p className="text-sm text-ink-muted">
          {resubmitting
            ? 'Fix what the reviewer flagged and submit it again for review.'
            : 'Your shop goes to an admin for review before you can list products.'}
        </p>
        {resubmitting && existing?.rejectionReason && (
          <p className="mt-1 text-sm text-danger">
            {existing.rejectionReason}
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        noValidate
      >
        <FormField label="Shop name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="organization" {...register('name')} />
        </FormField>

        <FormField
          label="Category"
          htmlFor="category"
          error={errors.category?.message}
        >
          <Select id="category" defaultValue="" {...register('category')}>
            <option value="" disabled>
              Select a category
            </option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Address"
          htmlFor="address"
          error={errors.address?.message}
        >
          <Input
            id="address"
            autoComplete="street-address"
            {...register('address')}
          />
        </FormField>

        <FormField
          label="Bio (optional)"
          htmlFor="bio"
          error={errors.bio?.message}
        >
          <Textarea
            id="bio"
            rows={3}
            placeholder="What you sell, in a sentence or two."
            {...register('bio')}
          />
        </FormField>

        <FormField
          label="Opening hours (optional)"
          htmlFor="openingHours"
          error={errors.openingHours?.message}
        >
          <Input
            id="openingHours"
            placeholder="Mon–Fri, 9am–6pm"
            {...register('openingHours')}
          />
        </FormField>

        <FormField
          label="Website (optional)"
          htmlFor="website"
          error={errors.website?.message}
        >
          <Input
            id="website"
            type="url"
            placeholder="https://example.com"
            {...register('website')}
          />
        </FormField>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-ink">
            Social links (optional)
          </legend>
          {SOCIAL_FIELDS.map(({ key, label }) => (
            <FormField
              key={key}
              label={label}
              htmlFor={`social-${key}`}
              error={errors.socialLinks?.[key]?.message}
            >
              <Input
                id={`social-${key}`}
                type="url"
                placeholder={`https://${key}.com/yourshop`}
                {...register(`socialLinks.${key}`)}
              />
            </FormField>
          ))}
        </fieldset>

        {errors.root?.server && (
          <p className="text-xs text-danger">{errors.root.server.message}</p>
        )}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Saving…'
            : resubmitting
            ? 'Resubmit for review'
            : 'Create shop'}
        </Button>
      </form>

      <p className="text-xs text-ink-muted">
        <a href="/dashboard" className="text-accent">
          Back to dashboard
        </a>
      </p>
    </div>
  );
}
