export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * A price, with the original struck through when the product is on sale.
 *
 * Note the catalogue sorts and filters on `price`, not on the discounted figure
 * shown here — a product on sale still sorts by its full price.
 */
export function Price({
  price,
  salePrice,
  className,
}: {
  price: number;
  salePrice?: number | null;
  className?: string;
}) {
  const onSale = salePrice != null && salePrice < price;

  return (
    <span className={className}>
      <span className="text-ink">
        {formatMoney(onSale ? (salePrice as number) : price)}
      </span>
      {onSale && (
        <span className="ml-1 text-ink-muted line-through">
          {formatMoney(price)}
        </span>
      )}
    </span>
  );
}
