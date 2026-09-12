import { redirect } from 'next/navigation';

export default function IndexPage() {
  // There is no seller landing page yet; /login is the only sensible entry.
  redirect('/login');
}
