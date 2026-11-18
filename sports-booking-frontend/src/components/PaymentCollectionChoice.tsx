import { useId } from 'react';

const OPTIONS = [
  { value: 'app', label: 'Pay through App', hint: 'Players see a Pay button.' },
  { value: 'offline', label: 'Settle Offline', hint: 'Players tap Mark as paid and upload a payment screenshot.' },
];

export default function PaymentCollectionChoice({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const name = useId();
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-2" data-testid="payment-collection">
      {OPTIONS.map(o => (
        <label key={o.value}
          className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${value === o.value ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)}
            className="sr-only" data-testid={`payment-collection-${o.value}`} />
          <span aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center ${value === o.value ? 'border-green-600' : 'border-gray-400 bg-white'}`}>
            {value === o.value && <span className="h-2.5 w-2.5 rounded-full bg-green-600" />}
          </span>
          <span>
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="block text-[11px] text-gray-500 leading-tight">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
