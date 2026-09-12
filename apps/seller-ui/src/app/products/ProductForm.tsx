'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useController, useForm } from 'react-hook-form';
import {
  CATEGORIES,
  productCreateSchema,
  type ProductCreateFormInput,
  type ProductCreateInput,
} from '@openshelf/types';
import {
  Button,
  FormField,
  Input,
  Select,
  TagInput,
  Textarea,
} from '@openshelf/ui';
import type { ApiError, Product } from '@/lib/api';
import { applyServerError } from '@/lib/form-errors';

export const PRODUCT_FIELDS = [
  'title',
  'description',
  'category',
  'subCategory',
  'tags',
  'price',
  'salePrice',
  'stock',
] as const;

export function productDefaults(product?: Product): ProductCreateFormInput {
  return {
    title: product?.title ?? '',
    description: product?.description ?? '',
    category: (product?.category ?? '') as ProductCreateFormInput['category'],
    subCategory: product?.subCategory ?? '',
    tags: product?.tags ?? [],
    // NaN rather than 0 so an untouched number field reads as "not filled in"
    // and fails required-validation, instead of silently submitting zero.
    price: product?.price ?? (NaN as unknown as number),
    salePrice: product?.salePrice ?? (undefined as unknown as number),
    stock: product?.stock ?? 0,
  };
}

export function ProductForm({
  product,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  product?: Product;
  submitLabel: string;
  pending: boolean;
  error: ApiError | null;
  onSubmit: (values: ProductCreateInput, dirty: Set<string>) => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, dirtyFields },
    // Three generics: the form holds the schema's *input* shape (tags and stock
    // optional), while handleSubmit hands the submit callback the parsed output.
  } = useForm<ProductCreateFormInput, unknown, ProductCreateInput>({
    // Create's schema is used for both: it is the stricter of the two, so the
    // edit form cannot produce a body that the update schema would reject.
    resolver: zodResolver(productCreateSchema),
    defaultValues: productDefaults(product),
  });

  // tags is a string[], which register() cannot drive.
  const tags = useController({ control, name: 'tags' });

  // In an effect, not in render: applyServerError calls setError, which would
  // re-render and run it again.
  useEffect(() => {
    if (error) {
      applyServerError(error, setError, PRODUCT_FIELDS);
    }
  }, [error, setError]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((values) =>
        onSubmit(values, new Set(Object.keys(dirtyFields)))
      )}
      noValidate
    >
      <FormField label="Title" htmlFor="title" error={errors.title?.message}>
        <Input id="title" {...register('title')} />
      </FormField>

      <FormField
        label="Description"
        htmlFor="description"
        error={errors.description?.message}
      >
        <Textarea id="description" rows={4} {...register('description')} />
      </FormField>

      <FormField
        label="Category"
        htmlFor="category"
        error={errors.category?.message}
      >
        <Select id="category" {...register('category')}>
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
        label="Sub-category (optional)"
        htmlFor="subCategory"
        error={errors.subCategory?.message}
      >
        <Input
          id="subCategory"
          placeholder="Drinkware"
          {...register('subCategory')}
        />
      </FormField>

      <FormField
        label="Tags (optional)"
        htmlFor="tags"
        error={errors.tags?.message}
      >
        <TagInput
          id="tags"
          value={tags.field.value ?? []}
          onChange={tags.field.onChange}
          placeholder="Type and press Enter"
        />
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Price" htmlFor="price" error={errors.price?.message}>
          {/* valueAsNumber because the schema takes z.number(); without it a
              string arrives and fails with a type error rather than a useful one. */}
          <Input
            id="price"
            type="number"
            step="0.01"
            min="0"
            {...register('price', { valueAsNumber: true })}
          />
        </FormField>

        <FormField
          label="Sale price"
          htmlFor="salePrice"
          error={errors.salePrice?.message}
        >
          <Input
            id="salePrice"
            type="number"
            step="0.01"
            min="0"
            {...register('salePrice', {
              // An empty field must be absent, not NaN.
              setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
            })}
          />
        </FormField>

        <FormField label="Stock" htmlFor="stock" error={errors.stock?.message}>
          <Input
            id="stock"
            type="number"
            step="1"
            min="0"
            {...register('stock', { valueAsNumber: true })}
          />
        </FormField>
      </div>

      {errors.root?.server && (
        <p className="text-xs text-danger">{errors.root.server.message}</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
