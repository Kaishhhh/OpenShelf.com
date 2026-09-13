'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { ProductImage } from '@/lib/catalogue-types';

/**
 * The image gallery — the only genuinely interactive part of the product page.
 *
 * Takes the images as a serializable prop so the surrounding page can stay a server
 * component; the first image is rendered in the server HTML, which is what a crawler and
 * an og:image consumer see.
 */
export function ProductGallery({
  images,
  title,
}: {
  images: ProductImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const selected = images[active];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-card border border-line bg-line/30">
        {selected ? (
          <Image
            src={selected.url}
            alt={title}
            fill
            sizes="(max-width: 768px) 100vw, 560px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            No photo
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-6 gap-1">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Photo ${index + 1}`}
              className={`relative aspect-square overflow-hidden rounded-card border ${
                index === active ? 'border-accent' : 'border-line'
              }`}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="96px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
