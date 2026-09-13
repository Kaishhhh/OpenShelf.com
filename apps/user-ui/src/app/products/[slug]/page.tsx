import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imagekitUrl } from '@/lib/imagekit-url';
import { fetchProduct } from '@/lib/server-api';
import { AddToCart } from '@/components/AddToCart';
import { Price } from '@/components/Price';
import { ProductGallery } from '@/components/ProductGallery';

/**
 * Shared by generateMetadata and the page body. Both call fetchProduct with the same URL
 * and options, which React memoizes for the duration of one render, so this is a single
 * upstream request rather than two.
 */
async function load(slug: string) {
  const product = await fetchProduct(slug);
  if (!product) {
    // A DRAFT or DELETED product, or one whose shop is no longer APPROVED, 404s
    // upstream. Answering with a real 404 status rather than a 200 carrying an
    // error panel is what makes it correct for a crawler.
    notFound();
  }
  return product;
}

export async function generateMetadata({
  params,
}: PageProps<'/products/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) {
    return { title: 'Product not found' };
  }

  // Trimmed: a description meta tag is truncated well before this anyway.
  const description = product.description.slice(0, 200);
  const image = product.images?.[0];

  return {
    title: `${product.title} — ${product.shop.name} | OpenShelf`,
    description,
    openGraph: {
      title: product.title,
      description,
      type: 'website',
      // Composed through the same loader the <Image> components use, so ?tr= is
      // built in exactly one place. Omitted entirely when there is no photo — a
      // broken og:image is worse than none.
      ...(image
        ? {
            images: [
              {
                url: imagekitUrl({
                  src: image.url,
                  width: 1200,
                  quality: 80,
                }),
                width: 1200,
                alt: product.title,
              },
            ],
          }
        : {}),
    },
  };
}

export default async function ProductDetailPage({
  params,
}: PageProps<'/products/[slug]'>) {
  const { slug } = await params;
  const product = await load(slug);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ProductGallery images={product.images ?? []} title={product.title} />

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-ink">{product.title}</h1>
            <p className="text-sm text-ink-muted">
              {product.category}
              {product.subCategory ? ` · ${product.subCategory}` : ''}
            </p>
          </div>

          <Price
            price={product.price}
            salePrice={product.salePrice}
            className="text-lg"
          />

          <p className="text-sm text-ink-muted">
            {product.stock > 0
              ? `${product.stock} in stock`
              : 'Currently out of stock'}
          </p>

          <p className="whitespace-pre-line text-sm text-ink">
            {product.description}
          </p>

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-card border border-line bg-line/40 px-1.5 py-0.5 text-xs text-ink-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* The only client island on this page — everything above it is
              server-rendered so a crawler sees the real product. */}
          <AddToCart
            productId={product.id}
            slug={product.slug}
            stock={product.stock}
          />

          <p className="border-t border-line pt-3 text-sm text-ink-muted">
            Sold by{' '}
            <a href={`/shops/${product.shop.id}`} className="text-accent">
              {product.shop.name}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
