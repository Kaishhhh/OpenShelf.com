'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '@openshelf/ui';
import { addProductImage, deleteProductImage, type ProductImage } from '@/lib/api';
import {
  MAX_PRODUCT_IMAGES,
  rejectionReason,
  uploadToImageKit,
} from '@/lib/imagekit-upload';

export function ImageManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImage[];
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['product', productId] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0);
      const uploaded = await uploadToImageKit(file, setProgress);
      // The server re-fetches this fileId from ImageKit and stores its own
      // canonical url — what the browser reports is never trusted.
      return addProductImage(productId, uploaded);
    },
    onSuccess: () => {
      setProgress(null);
      setMessage(null);
      refresh();
    },
    onError: (err: Error) => {
      setProgress(null);
      setMessage(err.message);
    },
  });

  const remove = useMutation({
    mutationFn: (imageId: string) => deleteProductImage(productId, imageId),
    onSuccess: refresh,
    onError: (err: Error) => setMessage(err.message),
  });

  function onPick(file: File | undefined) {
    if (!file) return;

    // Mirrors the server's checks so a 6MB photo is refused before it is sent,
    // not after. The server still enforces all of them.
    const reason = rejectionReason(file, images.length);
    if (reason) {
      setMessage(reason);
      return;
    }

    setMessage(null);
    upload.mutate(file);
  }

  const full = images.length >= MAX_PRODUCT_IMAGES;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink">Photos</h2>
        <span className="text-xs text-ink-muted">
          {images.length} of {MAX_PRODUCT_IMAGES}
        </span>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative overflow-hidden rounded-card border border-line"
            >
              <img
                src={image.url}
                alt=""
                className="h-24 w-full object-cover"
              />
              <button
                type="button"
                aria-label="Remove photo"
                disabled={remove.isPending}
                onClick={() => remove.mutate(image.id)}
                className="absolute right-1 top-1 rounded-card border border-line bg-surface px-1.5 text-xs text-ink-muted hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          // Reset so picking the same file twice still fires a change event.
          e.target.value = '';
        }}
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={full || upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? 'Uploading…' : 'Add a photo'}
        </Button>
        {full && (
          <span className="text-xs text-ink-muted">
            Remove one to add another.
          </span>
        )}
      </div>

      {progress !== null && (
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-card bg-line"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-ink-muted">{progress}%</span>
        </div>
      )}

      {message && <p className="text-xs text-danger">{message}</p>}
    </div>
  );
}
