const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

type CashfreeFactory = (opts: { mode: 'production' | 'sandbox' }) => {
  checkout: (opts: { paymentSessionId: string; redirectTarget: string }) => Promise<{ error?: { message?: string } }>;
};

declare global {
  interface Window { Cashfree?: CashfreeFactory }
}

let sdkPromise: Promise<CashfreeFactory> | null = null;

const loadSdk = (): Promise<CashfreeFactory> => {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Payment SDK failed to load')));
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error('Could not load the payment page. Check your internet connection.'));
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
};

/** Opens the Cashfree checkout modal; resolves to an error message, or '' on completion. */
export async function openCashfreeCheckout(order: { mode: string; payment_session_id: string }): Promise<string> {
  const cashfree = await loadSdk();
  const result = await cashfree({ mode: order.mode === 'production' ? 'production' : 'sandbox' })
    .checkout({ paymentSessionId: order.payment_session_id, redirectTarget: '_modal' });
  return result.error?.message || '';
}

/** Order ids look like etb_<gameId>_<userId>_<ts>. */
export function gameIdFromOrderId(orderId: string): number | null {
  const m = /^etb_(\d+)_\d+_\d+$/.exec(orderId);
  return m ? Number(m[1]) : null;
}
