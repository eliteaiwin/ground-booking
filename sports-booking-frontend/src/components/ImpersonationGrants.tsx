import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../services/api';
import type { ImpUser } from '../lib/impersonation';

/** Admin/Moderator: who this user may impersonate (e.g. two friends they nominate). */
export default function ImpersonationGrants({ userId }: { userId: number }) {
  const [grants, setGrants] = useState<ImpUser[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: number; name: string; phone: string }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { api.impersonationGrants(userId).then(setGrants).catch(() => {}); }, [userId]);
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { api.searchUsers({ search }).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const run = (p: Promise<ImpUser[]>) => p.then(g => { setGrants(g); setError(''); }).catch((e: Error) => setError(e.message));

  return (
    <div className="space-y-2" data-testid="impersonation-grants">
      <label className="block text-xs font-medium text-gray-600">Can impersonate (no OTP needed)</label>
      <div className="flex flex-wrap gap-1">
        {grants.map(g => (
          <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 text-xs px-2 py-1">
            {g.name}
            <button type="button" aria-label={`Remove ${g.name}`} onClick={() => run(api.removeImpersonationGrant(userId, g.id))}><X size={12} /></button>
          </span>
        ))}
        {!grants.length && <span className="text-xs text-gray-400">Nobody yet</span>}
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a friend's name or mobile to allow"
        className="w-full border rounded px-3 py-1.5 text-sm" data-testid="grant-search" />
      {results.filter(r => r.id !== userId && !grants.some(g => g.id === r.id)).slice(0, 8).map(r => (
        <button key={r.id} type="button" onClick={() => { setSearch(''); run(api.addImpersonationGrant(userId, r.id)); }}
          className="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-green-50 border">{r.name}</button>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
