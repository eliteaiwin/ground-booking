// A game's currency comes from its ground's country (backend sends `currency`, e.g. "₹", "$", "£", "AED").
export const DEFAULT_CURRENCY = '₹';

// Keep in sync with sports-booking-backend/app/currency.py
const COUNTRY_CURRENCY: Record<string, string> = {
  '91': '₹', '44': '£', '1': '$', '971': 'AED', '966': 'SAR', '974': 'QAR',
  '65': 'S$', '61': 'A$', '64': 'NZ$', '49': '€', '977': 'NPR', '94': 'LKR',
};

export const currencyForCountry = (code?: string | null): string =>
  COUNTRY_CURRENCY[(code || '').trim().replace(/^\+/, '')] || DEFAULT_CURRENCY;

export const currencySymbol = (c?: string | null): string => {
  const v = (c || '').trim();
  if (!v || v === 'Rs' || v.toUpperCase() === 'INR') return '₹';
  if (v.toUpperCase() === 'USD') return '$';
  return v;
};

/** "₹500", "$12.50", "AED 40" — symbol first; letter codes get a space. */
export const formatMoney = (amount: number | string, currency?: string | null): string => {
  const sym = currencySymbol(currency);
  const text = typeof amount === 'number' ? String(amount) : amount;
  return /[A-Za-z]$/.test(sym) ? `${sym} ${text}` : `${sym}${text}`;
};

/** Add amounts up per currency: [["₹", 6000], ["$", 40]]. */
export const sumByCurrency = <T,>(items: T[], currency: (i: T) => string | undefined | null, amount: (i: T) => number): [string, number][] => {
  const totals = new Map<string, number>();
  for (const i of items) {
    const c = currencySymbol(currency(i));
    totals.set(c, (totals.get(c) || 0) + amount(i));
  }
  return [...totals.entries()];
};
