import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

export interface PersonOption { id: number | string; label: string; search?: string }

/** Type-to-search picker for choosing one person, replacing long dropdowns. */
export function PersonSearch({ options, value, onChange, placeholder = 'Type first few characters...', disabled, testId }: {
  options: PersonOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [q, setQ] = useState('');
  const picked = options.find(o => String(o.id) === value);
  if (picked) {
    return (
      <div className="flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-green-50" data-testid={testId && `${testId}-picked`}>
        <span>{picked.label}</span>
        {!disabled && (
          <button type="button" aria-label="Clear" onClick={() => { onChange(''); setQ(''); }} className="text-gray-500 hover:text-gray-800">
            <X size={14} />
          </button>
        )}
      </div>
    );
  }
  const query = q.trim().toLowerCase();
  const matches = query ? options.filter(o => `${o.label} ${o.search ?? ''}`.toLowerCase().includes(query)).slice(0, 8) : [];
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
        <Input placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} className="pl-8 text-sm"
          disabled={disabled} data-testid={testId} />
      </div>
      {query && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto bg-white">
          {matches.map(o => (
            <button key={o.id} type="button" onClick={() => { onChange(String(o.id)); setQ(''); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-green-50">{o.label}</button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No match</p>}
        </div>
      )}
    </div>
  );
}
