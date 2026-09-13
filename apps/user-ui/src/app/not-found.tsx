/**
 * Rendered by notFound(). Lives inside the root layout, so a 404 keeps the site
 * chrome instead of Next's unstyled default page.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
      <h1 className="text-base font-semibold text-ink">Not available</h1>
      <p className="text-sm text-ink-muted">
        This page is no longer listed, or never was.
      </p>
      <p className="text-sm">
        <a href="/products" className="text-accent">
          Browse everything else
        </a>
      </p>
    </div>
  );
}
