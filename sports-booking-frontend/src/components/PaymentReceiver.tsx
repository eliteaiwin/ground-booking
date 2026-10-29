import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Copy, Wallet } from 'lucide-react';

export type ReceiverMethodKind = 'upi' | 'paytm' | 'phonepe' | 'gpay';
export interface ReceiverMethod { kind: ReceiverMethodKind; value: string }
export interface PublicReceiver { id: number; nick_name: string; methods: ReceiverMethod[] }

export const METHOD_LABELS: Record<ReceiverMethodKind, string> = {
  upi: 'UPI ID',
  paytm: 'Paytm number',
  phonepe: 'PhonePe number',
  gpay: 'Google Pay number',
};

type App = 'paytm' | 'phonepe' | 'gpay' | 'cred' | 'upi';

const HANDLE_APPS: [App, string[]][] = [
  ['phonepe', ['ybl', 'ibl', 'axl']],
  ['paytm', ['paytm', 'ptyes', 'ptaxis', 'pthdfc', 'ptsbi']],
  ['gpay', ['okaxis', 'okhdfcbank', 'okicici', 'oksbi']],
  ['cred', ['axisb', 'yescred']],
];

/** Which app a UPI ID belongs to, from its handle (e.g. "@ybl" is PhonePe). */
export const methodApp = (m: ReceiverMethod): App => {
  if (m.kind !== 'upi') return m.kind;
  const handle = m.value.split('@')[1]?.toLowerCase() || '';
  return HANDLE_APPS.find(([, hs]) => hs.includes(handle))?.[0] || 'upi';
};

const APP_NAMES: Record<App, string> = { paytm: 'Paytm', phonepe: 'PhonePe', gpay: 'Google Pay', cred: 'CRED', upi: 'UPI' };

export function AppBadge({ app }: { app: App }) {
  const base = 'inline-flex items-center justify-center w-12 h-7 rounded-md text-[10px] font-extrabold shrink-0';
  if (app === 'paytm') return <span className={`${base} bg-[#00BAF2] text-white`} aria-label="Paytm">Paytm</span>;
  if (app === 'phonepe') return <span className={`${base} bg-[#5F259F] text-white text-[9px]`} aria-label="PhonePe">PhonePe</span>;
  if (app === 'cred') return <span className={`${base} bg-black text-white tracking-wider`} aria-label="CRED">CRED</span>;
  if (app === 'gpay') return (
    <span className={`${base} bg-white border text-xs`} aria-label="Google Pay">
      <span className="text-[#4285F4]">G</span><span className="text-[#EA4335]">P</span><span className="text-[#FBBC05]">a</span><span className="text-[#34A853]">y</span>
    </span>
  );
  return <span className={`${base} bg-white border italic`} aria-label="UPI"><span className="text-[#097939]">U</span><span className="text-[#ED752E]">PI</span></span>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${text}`} data-testid="copy-pay-method"
      onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className={`p-1.5 rounded-md border ${done ? 'text-green-600 border-green-300' : 'text-gray-500 hover:text-green-600'}`}>
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

/** "Pay to: Tittle Wallet [wallet]" — the wallet opens every way to pay that receiver. */
export function PayTo({ receiver, className = '' }: { receiver: PublicReceiver; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className={`inline-flex items-center gap-1.5 ${className}`} data-testid="pay-to">
        Pay to: <strong>{receiver.nick_name}</strong>
        <button type="button" onClick={() => setOpen(true)} aria-label="Ways to pay" data-testid="pay-to-wallet"
          className="p-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200">
          <Wallet size={16} />
        </button>
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="pay-ways">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Wallet size={18} /> Pay to {receiver.nick_name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {receiver.methods.map(m => {
              const app = methodApp(m);
              return (
                <div key={`${m.kind}-${m.value}`} className="flex items-center gap-3 p-2 border rounded-lg">
                  <AppBadge app={app} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-gray-500">{m.kind === 'upi' ? `${APP_NAMES[app] === 'UPI' ? '' : APP_NAMES[app] + ' '}UPI ID` : METHOD_LABELS[m.kind]}</div>
                    <div className="text-sm font-medium break-all">{m.value}</div>
                  </div>
                  <CopyButton text={m.value} />
                </div>
              );
            })}
            <p className="text-xs text-gray-500">Copy a UPI ID or number, pay in your app, then come back and tap Mark as paid.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Pay to" dropdown of the receivers tagged to a ground. `value` '0' means none. */
export function ReceiverSelect({ groundName, value, onChange, autoPick = false }: {
  groundName: string; value: string; onChange: (v: string) => void; autoPick?: boolean;
}) {
  const [options, setOptions] = useState<{ id: number; nick_name: string }[]>([]);
  useEffect(() => {
    if (!groundName) { setOptions([]); return; }
    api.receiversForGround(groundName).then((r: { id: number; nick_name: string }[]) => {
      setOptions(r);
      if (autoPick && r.length === 1 && (!value || value === '0')) onChange(String(r[0].id));
      if (value && value !== '0' && !r.some(o => String(o.id) === value)) onChange('0');
    }).catch(() => setOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundName]);
  return (
    <div className="space-y-1" data-testid="receiver-select">
      <Label>Pay to</Label>
      <Select value={value || '0'} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Choose payment receiver" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Not set</SelectItem>
          {options.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nick_name}</SelectItem>)}
        </SelectContent>
      </Select>
      {groundName && options.length === 0 && (
        <p className="text-xs text-gray-500">No payment receivers for this ground yet. Add them under Dashboard → Receivers.</p>
      )}
    </div>
  );
}
