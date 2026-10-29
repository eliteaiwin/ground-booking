import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react';
import { AppBadge, METHOD_LABELS, methodApp, type ReceiverMethod, type ReceiverMethodKind } from '@/components/PaymentReceiver';

interface Receiver {
  id: number;
  nick_name: string;
  methods: ReceiverMethod[];
  grounds: { id: number; display_name: string }[];
  owner?: Owner | null;
}
interface Owner { id: number; name: string; phone: string }
interface GroundOption { id: number; display_name: string }

const KINDS: ReceiverMethodKind[] = ['upi', 'paytm', 'phonepe', 'gpay'];
const PLACEHOLDERS: Record<ReceiverMethodKind, string> = {
  upi: '9811536174@axisb', paytm: '9811536174', phonepe: '9811536174', gpay: '9811536174',
};
const blankMethod = (): ReceiverMethod => ({ kind: 'upi', value: '' });

export default function PaymentReceivers({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('admin');
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [grounds, setGrounds] = useState<GroundOption[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [nick, setNick] = useState('');
  const [methods, setMethods] = useState<ReceiverMethod[]>([blankMethod()]);
  const [groundIds, setGroundIds] = useState<number[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState<Owner[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.listReceivers().then(setReceivers).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
    (isAdmin ? api.listGrounds() : api.myManagedGrounds())
      .then((g: GroundOption[]) => setGrounds(g.map(x => ({ id: x.id, display_name: x.display_name }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (r: Receiver | null) => {
    setError('');
    setEditing(r ? r.id : 'new');
    setNick(r?.nick_name || '');
    setMethods(r?.methods.length ? r.methods.map(m => ({ ...m })) : [blankMethod()]);
    setGroundIds(r?.grounds.map(g => g.id) || []);
    setOwner(r?.owner || null);
    setOwnerQuery('');
    setOwnerResults([]);
  };

  const save = async () => {
    setSaving(true); setError('');
    const body = { nick_name: nick, methods: methods.filter(m => m.value.trim()), ground_ids: groundIds, user_id: owner?.id };
    try {
      if (editing === 'new') await api.createReceiver(body);
      else if (editing) await api.updateReceiver(editing, body);
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Receiver) => {
    if (!window.confirm(`Remove ${r.nick_name}? Upcoming games that pay to it will show no receiver.`)) return;
    try { await api.deleteReceiver(r.id); await load(); } catch (e) { setError((e as Error).message); }
  };

  const setMethod = (i: number, m: Partial<ReceiverMethod>) =>
    setMethods(ms => ms.map((x, j) => (j === i ? { ...x, ...m } : x)));

  const form = (
    <Card data-testid="receiver-form">
      <CardContent className="p-4 space-y-4">
        <div className="space-y-1">
          <Label>Nick Name</Label>
          <Input value={nick} onChange={e => setNick(e.target.value)} placeholder="Tittle Wallet" maxLength={40} data-testid="receiver-nick" />
          <p className="text-xs text-gray-500">Players only see this name.</p>
        </div>
        <div className="space-y-1">
          <Label>Receiver (app user)</Label>
          {owner ? (
            <div className="flex items-center justify-between border rounded-md px-3 py-2 text-sm" data-testid="receiver-owner">
              <span>{owner.name} <span className="text-gray-500">{owner.phone}</span></span>
              <button type="button" className="text-xs text-blue-600" onClick={() => setOwner(null)}>Change</button>
            </div>
          ) : (
            <>
              <Input value={ownerQuery} placeholder="Search name or mobile" data-testid="receiver-owner-search"
                onChange={e => {
                  const q = e.target.value;
                  setOwnerQuery(q);
                  if (q.trim().length >= 2) api.searchReceiverUsers(q).then(setOwnerResults).catch(() => setOwnerResults([]));
                  else setOwnerResults([]);
                }} />
              {ownerResults.map(u => (
                <button type="button" key={u.id} className="block w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 border-b"
                  onClick={() => { setOwner(u); setOwnerResults([]); setOwnerQuery(''); }}>
                  {u.name} <span className="text-gray-500">{u.phone}</span>
                </button>
              ))}
            </>
          )}
          <p className="text-xs text-gray-500">Gets the Payment Receiver role to confirm payments. Players never see this name.</p>
        </div>
        <div className="space-y-2">
          <Label>Ways to pay</Label>
          {methods.map((m, i) => (
            <div key={i} className="flex items-center gap-2" data-testid="receiver-method">
              <div className="w-36 shrink-0">
                <Select value={m.kind} onValueChange={v => setMethod(i, { kind: v as ReceiverMethodKind })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KINDS.map(k => <SelectItem key={k} value={k}>{METHOD_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Input className="h-9 min-w-0" value={m.value} placeholder={PLACEHOLDERS[m.kind]}
                inputMode={m.kind === 'upi' ? 'email' : 'tel'} onChange={e => setMethod(i, { value: e.target.value })} />
              {methods.length > 1 && (
                <button type="button" aria-label="Remove" onClick={() => setMethods(ms => ms.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600"><X size={16} /></button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setMethods(ms => [...ms, blankMethod()])} data-testid="add-method">
            <Plus size={14} className="mr-1" /> Add another way
          </Button>
        </div>
        <div className="space-y-1">
          <Label>Grounds</Label>
          {grounds.length === 0 && <p className="text-xs text-gray-500">No grounds to tag.</p>}
          <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
            {grounds.map(g => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={groundIds.includes(g.id)}
                  onCheckedChange={c => setGroundIds(ids => (c ? [...ids, g.id] : ids.filter(x => x !== g.id)))} />
                {g.display_name}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">Moderators of these grounds can pick this receiver when creating a game.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={saving} onClick={save} data-testid="save-receiver">
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b"><div className="px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
        <h1 className="font-semibold flex items-center gap-2 flex-1"><Wallet size={18} /> Payment Receivers</h1>
        {editing === null && (
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => startEdit(null)} data-testid="new-receiver">
            <Plus size={14} className="mr-1" /> Add
          </Button>
        )}
      </div></header>
      <div className="p-4 space-y-3 max-w-xl mx-auto">
        {editing === 'new' && form}
        {error && editing === null && <p className="text-sm text-red-600">{error}</p>}
        {receivers.length === 0 && editing === null && (
          <p className="text-sm text-gray-500 text-center py-8">No payment receivers yet. Tap Add to create one, e.g. "Tittle Wallet".</p>
        )}
        {receivers.map(r => editing === r.id ? <div key={r.id}>{form}</div> : (
          <Card key={r.id} data-testid="receiver-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{r.nick_name}</h3>
                  {r.owner && <p className="text-xs text-gray-500">{r.owner.name} · {r.owner.phone}</p>}
                </div>
                <div className="flex gap-1">
                  <button aria-label="Edit" onClick={() => startEdit(r)} className="p-1.5 text-gray-500 hover:text-blue-600"><Pencil size={16} /></button>
                  <button aria-label="Remove" onClick={() => remove(r)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
              </div>
              {r.methods.map(m => (
                <div key={`${m.kind}-${m.value}`} className="flex items-center gap-2 text-sm">
                  <AppBadge app={methodApp(m)} />
                  <span className="text-gray-500 text-xs w-24 shrink-0">{METHOD_LABELS[m.kind]}</span>
                  <span className="break-all">{m.value}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 pt-1">
                {r.grounds.length === 0
                  ? <span className="text-xs text-orange-600">Not tagged to any ground</span>
                  : r.grounds.map(g => <span key={g.id} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">{g.display_name}</span>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
