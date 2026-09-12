export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}
