import './global.css';
import { Providers } from './providers';

export const metadata = {
  title: 'OpenShelf for Sellers',
  description: 'Manage your OpenShelf shop.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
