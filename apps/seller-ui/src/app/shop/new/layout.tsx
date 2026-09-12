export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-surface px-4 py-10">
      {children}
    </div>
  );
}
