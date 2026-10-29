import { useEffect, useState } from 'react';
import { api, backendUrl } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HardDrive, Trash2, Video } from 'lucide-react';

interface GameUsage { game_id: number | null; title: string; game_date?: string; messages: number; media: number; bytes: number; oldest?: string }
interface MediaUsage { id: number; media_type: string; bytes: number; created_at: string; user_name: string; game_title: string; game_date?: string; in_gallery: boolean; file_path: string }
interface Usage { messages: number; media: number; bytes: number; games: GameUsage[]; items: MediaUsage[] }
type What = 'all' | 'messages' | 'media';

const WHAT_LABEL: Record<What, string> = { all: 'Chats and photos/videos', messages: 'Chats only', media: 'Photos/videos only' };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const shortDate = (d?: string) => (d ? new Date(d.replace(' ', 'T')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '');

export default function DiscussionStorage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [days, setDays] = useState('30');
  const [what, setWhat] = useState<What>('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = () => api.getDiscussionStorage().then(setUsage).catch(e => setMsg(e instanceof Error ? e.message : 'Failed to load'));
  useEffect(() => { load(); }, []);

  const run = async (body: { older_than_days?: number; game_id?: number; what: What }, confirmText: string) => {
    if (!window.confirm(`${confirmText}\n\nThis can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await api.cleanupDiscussions(body);
      setMsg(`Deleted ${r.deleted_messages} chats and ${r.deleted_media} photos/videos, freed ${formatBytes(r.freed_bytes)}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (id: number) => {
    if (!window.confirm('Delete this photo/video permanently?')) return;
    await api.deleteMedia(id).catch(() => undefined);
    await load();
  };

  if (!usage) return <p className="text-sm text-gray-500 p-4">{msg || 'Loading...'}</p>;
  const items = [...usage.items].sort((a, b) => b.bytes - a.bytes);

  return (
    <div className="space-y-4" data-testid="discussion-storage">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><HardDrive size={16} /> Chat Storage</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-lg font-bold">{usage.messages}</p><p className="text-xs text-gray-500">Chats</p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-lg font-bold">{usage.media}</p><p className="text-xs text-gray-500">Photos/videos</p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-lg font-bold">{formatBytes(usage.bytes)}</p><p className="text-xs text-gray-500">Space used</p></div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Clear older items</p>
            <div className="flex gap-2">
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['7', '30', '60', '90', '180', '365'].map(d => <SelectItem key={d} value={d}>Older than {d}d</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={what} onValueChange={v => setWhat(v as What)}>
                <SelectTrigger className="flex-1 min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(WHAT_LABEL) as What[]).map(w => <SelectItem key={w} value={w}>{WHAT_LABEL[w]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full bg-red-600 hover:bg-red-700" disabled={busy} data-testid="cleanup-older"
              onClick={() => run({ older_than_days: Number(days), what }, `Permanently delete ${WHAT_LABEL[what].toLowerCase()} older than ${days} days?`)}>
              <Trash2 size={14} className="mr-2" /> Clear older than {days} days
            </Button>
          </div>
          {msg && <p className="text-xs text-gray-600">{msg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By game (oldest first)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {usage.games.length === 0 && <p className="text-xs text-gray-500">Nothing stored.</p>}
          {usage.games.map(g => (
            <div key={g.game_id ?? 0} className="flex items-center gap-2 text-sm border rounded-lg p-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{g.title}{g.game_date ? ` · ${shortDate(g.game_date)}` : ''}</p>
                <p className="text-xs text-gray-500">{g.messages} chats · {g.media} photos/videos · {formatBytes(g.bytes)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-red-600 border-red-300" disabled={busy}
                onClick={() => run({ game_id: g.game_id ?? 0, what: 'all' }, `Permanently delete all chats and photos/videos of ${g.title}?`)}>
                Clear
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Photos and videos (largest first)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && <p className="text-xs text-gray-500">No photos or videos.</p>}
          {(showAll ? items : items.slice(0, 20)).map(m => (
            <div key={m.id} className="flex items-center gap-2 text-sm border rounded-lg p-2" data-testid="storage-item">
              {m.media_type === 'photo'
                ? <img src={backendUrl(m.file_path)} alt="" className="w-12 h-12 object-cover rounded" />
                : <div className="w-12 h-12 bg-gray-900 rounded flex items-center justify-center"><Video size={16} className="text-white" /></div>}
              <div className="flex-1 min-w-0">
                <p className="truncate">{m.game_title}</p>
                <p className="text-xs text-gray-500">{formatBytes(m.bytes)} · {m.user_name} · {shortDate(m.created_at)}</p>
              </div>
              <button type="button" onClick={() => deleteItem(m.id)} className="p-2 text-red-500" aria-label="Delete permanently"><Trash2 size={16} /></button>
            </div>
          ))}
          {!showAll && items.length > 20 && <Button variant="outline" className="w-full" onClick={() => setShowAll(true)}>Show all {items.length}</Button>}
        </CardContent>
      </Card>
    </div>
  );
}
