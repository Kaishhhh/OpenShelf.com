import './global.css';
import { CartIndicator } from '@/components/CartIndicator';
import { HeaderAccount } from '@/components/HeaderAccount';
import { Providers } from './providers';

export const metadata = {
  title: 'OpenShelf',
  description: 'Browse products from independent shops.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-surface text-ink">
        <Providers>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
              <a href="/" className="text-sm font-semibold text-ink">
                OpenShelf
              </a>
              <nav className="flex gap-3 text-sm text-ink-muted">
                <a href="/products" className="hover:text-ink">
                  Browse
                </a>
              </nav>
              <div className="ml-auto flex items-center gap-3 text-sm text-ink-muted">
                <CartIndicator />
                <a href="/orders" className="hover:text-ink">
                  Orders
                </a>
                <HeaderAccount />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
