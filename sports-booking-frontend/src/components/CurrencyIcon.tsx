import { currencySymbol } from '@/lib/currency';

/** Drop-in for lucide's DollarSign: shows the currency symbol (₹, $, £…) at icon size. */
export default function CurrencyIcon({ currency, size = 16, className = '' }: { currency?: string | null; size?: number; className?: string }) {
  const sym = currencySymbol(currency);
  return (
    <span aria-hidden className={`inline-flex items-center justify-center font-bold leading-none shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: sym.length > 1 ? size * 0.55 : size * 0.95 }}>
      {sym}
    </span>
  );
}
