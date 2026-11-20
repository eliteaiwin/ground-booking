import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../services/api';
import { impersonate, type ImpUser } from '../lib/impersonation';

export default function ImpersonateDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<ImpUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api.impersonationTargets(search).then(setUsers).catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const pick = async (u: ImpUser) => {
    setBusy(true);
    setError('');
    try { await impersonate(u); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col" onMouseDown={e => e.stopPropagation()}
        data-testid="impersonate-dialog">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold">Impersonate User</h3>
            <p className="text-xs text-gray-500">Act as a friend, e.g. to nominate them for a game.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name or mobile"
            className="w-full border rounded-lg px-3 py-2 text-sm" data-testid="impersonate-search" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {users.map(u => (
            <button key={u.id} type="button" disabled={busy} onClick={() => pick(u)} data-testid="impersonate-target"
              className="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left hover:bg-gray-50">
              <span className="text-sm font-medium">{u.name}</span>
              <span className="text-xs text-gray-500">{u.role}</span>
            </button>
          ))}
          {!users.length && !error && (
            <p className="text-sm text-gray-500 text-center py-4">
              {search ? 'Nobody you can impersonate matches.' : 'Type to search, or ask an Admin/Moderator to allow you to impersonate your friends.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
