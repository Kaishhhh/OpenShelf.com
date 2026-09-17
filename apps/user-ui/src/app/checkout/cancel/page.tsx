export const metadata = { title: 'Checkout cancelled | OpenShelf' };

/**
 * Where "Cancel" on the payment form goes. Nothing needs undoing: stock is only touched
 * when a payment is confirmed, and the unconfirmed PaymentIntent simply goes unused.
 */
export default function CheckoutCancelPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-lg font-semibold text-ink">Payment not completed</h1>
      <p className="text-sm text-ink-muted">
        You have not been charged, and your cart is unchanged.
      </p>
      <a href="/cart" className="text-sm text-accent">
        Back to your cart
      </a>
    </div>
  );
}
