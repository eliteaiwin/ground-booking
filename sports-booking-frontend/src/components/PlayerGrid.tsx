import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { sportIconChar, sportLabel } from '../lib/sportIcon';

export interface GridPlayer {
  user_id: number;
  name: string;
  display_name: string;
  sports: string[];
  age: number | null;
  potd_wins: number;
  games_played: number;
  goals: number;
}

type SortKey = 'name' | 'sports' | 'age' | 'potd' | 'goals';

const preferredName = (p: GridPlayer) => p.display_name || (p.name || '').split(' ')[0];

const sortValue = (p: GridPlayer, key: SortKey): string | number => {
  switch (key) {
    case 'name': return preferredName(p).toLowerCase();
    case 'sports': return p.sports.join(',');
    case 'age': return p.age ?? -1;
    case 'potd': return p.potd_wins * 1000 - p.games_played;
    case 'goals': return p.goals;
  }
};

interface Props {
  players: GridPlayer[];
  onSelect: (userId: number) => void;
  pageSize?: number;
}

export default function PlayerGrid({ players, onSelect, pageSize = 10 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return desc ? -cmp : cmp;
    });
    return list;
  }, [players, sortKey, desc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const rows = sorted.slice((current - 1) * pageSize, current * pageSize);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setDesc(d => !d);
    else { setSortKey(key); setDesc(key !== 'name' && key !== 'sports'); }
    setPage(1);
  };

  const Header = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`px-1.5 py-1 font-medium ${className}`}>
      <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-0.5 hover:text-gray-900">
        {label}
        {sortKey === k ? (desc ? <ArrowDown size={10} /> : <ArrowUp size={10} />) : <ArrowUpDown size={10} className="opacity-40" />}
      </button>
    </th>
  );

  return (
    <div>
      <div className="overflow-x-auto border rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Header k="name" label="Name" className="text-left" />
              <Header k="sports" label="Sports" className="text-left" />
              <Header k="age" label="Age" className="text-right" />
              <Header k="potd" label="POTD" className="text-right" />
              <Header k="goals" label="Goals" className="text-right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.user_id} onClick={() => onSelect(p.user_id)} className="border-t cursor-pointer hover:bg-green-50" data-testid="player-grid-row">
                <td className="px-1.5 py-1.5 font-medium">{preferredName(p)}</td>
                <td className="px-1.5 py-1.5" title={p.sports.map(sportLabel).join(', ')}>{p.sports.map(sportIconChar).join(' ')}</td>
                <td className="px-1.5 py-1.5 text-right">{p.age ?? '—'}</td>
                <td className="px-1.5 py-1.5 text-right">{p.potd_wins}/{p.games_played}</td>
                <td className="px-1.5 py-1.5 text-right">{p.goals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-2 text-xs">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Prev</button>
          <span>Page {current} of {totalPages}</span>
          <button type="button" disabled={current >= totalPages} onClick={() => setPage(current + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
