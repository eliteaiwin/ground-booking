import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BellRing } from 'lucide-react';
import { api } from '../services/api';
import { openCashfreeCheckout } from '@/lib/cashfree';

export interface PaymentHistoryItem {
  game_id: number;
  game_name: string;
  title: string;
  game_date: string;
  game_time: string;
  game_status: string;
  amount: number;
  paid_amount: number;
  remaining: number;
  balance: number;
  payee_name: string;
  pay_online: boolean;
  can_pay: boolean;
  paid_at: string | null;
  paid_via: string;
  done_minutes: number | null;
  can_settle: boolean;
}

interface History {
  series: string;
  summary: { owed: number; paid: number; due: number; excess: number; outstanding: number; avg_pay_minutes: number | null };
  items: PaymentHistoryItem[];
}

type SortKey = 'game_name' | 'game_date' | 'amount' | 'paid_amount' | 'balance' | 'done_minutes';

const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const money = (n: number) => `₹${num(n)}`;

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return '';
  if (minutes < 0) return 'Before game end';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const shortDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

interface Props {
  userId: number;
  /** Limit to the series of this game (e.g. every "Wed Blr united" game). */
  gameId?: number;
  /** Show the Game name column (whole-history view). */
  showGame?: boolean;
}

export default function PaymentHistory({ userId, gameId, showGame = false }: Props) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'game_date', asc: false });
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setError('');
    api.getPaymentHistory(userId, gameId)
      .then((d: History) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load payments'));
  }, [userId, gameId]);

  useEffect(() => { setData(null); load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const val = (i: PaymentHistoryItem): string | number => {
      if (sort.key === 'game_date') return `${i.game_date} ${i.game_time}`;
      if (sort.key === 'game_name') return i.game_name.toLowerCase();
      if (sort.key === 'done_minutes') return i.done_minutes ?? Number.MAX_SAFE_INTEGER;
      return i[sort.key];
    };
    return [...data.items].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.asc ? c : -c;
    });
  }, [data, sort]);

  const act = async (item: PaymentHistoryItem, kind: 'settle' | 'remind' | 'pay') => {
    if (kind === 'pay' && !item.pay_online) {
      const to = item.payee_name ? ` to ${item.payee_name}` : '';
      if (!window.confirm(`Have you paid ${money(item.remaining)}${to} for ${item.title} (${shortDate(item.game_date)})? This marks it as paid.`)) return;
    }
    if (kind === 'settle') {
      const what = item.remaining > 0 ? `due of ${money(item.remaining)} was paid` : `excess of ${money(-item.remaining)} was returned`;
      if (!window.confirm(`Confirm the ${what} offline for ${item.title} (${shortDate(item.game_date)})? Remaining becomes ₹0.`)) return;
    }
    setBusy(item.game_id);
    setNote('');
    try {
      let msg = '';
      if (kind === 'pay' && item.pay_online) {
        const order = await api.createPaymentOrder(item.game_id);
        const sdkError = await openCashfreeCheckout(order);
        const result = await api.verifyPaymentOrder(order.order_id);
        if (result.status !== 'paid') throw new Error(sdkError || 'Payment not completed. If money was deducted, it will update here automatically.');
        msg = 'Payment received';
      } else {
        const r = kind === 'pay' ? await api.recordPayment(item.game_id)
          : kind === 'settle' ? await api.settlePaymentOffline(userId, item.game_id)
          : await api.remindPayment(userId, item.game_id);
        msg = r.message || 'Done';
      }
      setNote(msg);
      if (kind !== 'remind') load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-red-600 text-center py-4">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500 text-center py-4">Loading payments...</p>;

  const s = data.summary;
  const anyAction = data.items.some(i => i.can_settle || i.can_pay);
  const sortBtn = (key: SortKey, label: string, right = false) => (
    <button
      type="button"
      data-testid={`sort-${key}`}
      className={`inline-flex items-center gap-0.5 ${right ? 'flex-row-reverse' : ''}`}
      onClick={() => setSort(p => ({ key, asc: p.key === key ? !p.asc : key === 'game_name' }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="text-gray-300" />}
    </button>
  );
  const head = (key: SortKey, label: string, right = false) => (
    <th className={`px-1 py-1.5 font-medium ${right ? 'text-right' : 'text-left'}`}>{sortBtn(key, label, right)}</th>
  );

  return (
    <div data-testid="payment-history" className="space-y-3">
      {data.series && <p className="text-xs text-gray-500 text-center">Showing only <b>{data.series}</b> games</p>}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className={`rounded-lg p-2 ${s.outstanding > 0 ? 'bg-red-50' : s.outstanding < 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
          <p className="text-[11px] text-gray-500">Balance</p>
          <p data-testid="pay-outstanding" className={`font-bold ${s.outstanding > 0 ? 'text-red-600' : s.outstanding < 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {s.outstanding > 0 ? `−${money(s.outstanding)}` : s.outstanding < 0 ? `+${money(-s.outstanding)}` : money(0)}
            {s.outstanding !== 0 && <span className="block text-[10px] font-normal">{s.outstanding > 0 ? 'due' : 'excess'}</span>}
          </p>
        </div>
        <div className="rounded-lg p-2 bg-gray-50">
          <p className="text-[11px] text-gray-500">Avg paying time</p>
          <p data-testid="pay-avg" className="font-bold text-gray-800">{s.avg_pay_minutes == null ? '-' : formatDuration(s.avg_pay_minutes)}</p>
        </div>
        <div className="rounded-lg p-2 bg-gray-50">
          <p className="text-[11px] text-gray-500">Paid</p>
          <p data-testid="pay-paid" className="font-bold text-gray-800">{money(s.paid)} <span className="text-[11px] font-normal text-gray-500">of {money(s.owed)}</span></p>
        </div>
        <div className="rounded-lg p-2 bg-gray-50">
          <p className="text-[11px] text-gray-500">Due</p>
          <p data-testid="pay-due" className={`font-bold ${s.due > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {money(s.due)}{s.excess > 0 && <span className="block text-[11px] font-normal text-amber-600">{money(s.excess)} excess</span>}
          </p>
        </div>
      </div>
      {note && <p className="text-xs text-center text-blue-700">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-2">No payments yet</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[11px] whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {showGame ? (
                  <th className="px-1 py-1.5 font-medium text-left">
                    <div className="flex flex-col items-start gap-0.5">{sortBtn('game_date', 'Date')}{sortBtn('game_name', 'Game')}</div>
                  </th>
                ) : head('game_date', 'Date')}
                {head('amount', 'Owed ₹', true)}
                {head('paid_amount', 'Paid', true)}
                {head('balance', 'Balance', true)}
                {head('done_minutes', 'Done in')}
                {anyAction && <th className="px-0.5 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.game_id} data-testid="pay-row" className="border-t">
                  <td className="px-1 py-1.5">
                    {shortDate(i.game_date)}
                    {showGame && <span data-testid="pay-game" className="block text-[10px] text-gray-500 max-w-[96px] truncate" title={i.game_name}>{i.game_name}</span>}
                  </td>
                  <td className="px-1 py-1.5 text-right">{num(i.amount)}</td>
                  <td className="px-1 py-1.5 text-right">{num(i.paid_amount)}</td>
                  <td data-testid="pay-balance" className={`px-1 py-1.5 text-right font-medium ${i.balance < 0 ? 'text-red-600' : i.balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    {i.balance > 0 ? `+${num(i.balance)}` : i.balance < 0 ? `−${num(-i.balance)}` : '0'}
                  </td>
                  <td className="px-1 py-1.5" title={i.paid_at ? `Paid ${i.paid_at}${i.paid_via ? ` (${i.paid_via})` : ''}` : ''}>
                    {i.remaining > 0 ? <span className="text-gray-400">Unpaid</span> : formatDuration(i.done_minutes) || '-'}
                    {i.paid_via === 'offline' && <span className="block text-[9px] text-gray-500">offline</span>}
                  </td>
                  {anyAction && (
                    <td className="px-0.5 py-1 text-right">
                      {i.can_pay && (
                        <button type="button" data-testid="pay-now" disabled={busy === i.game_id}
                          className="px-2 py-1 rounded bg-orange-600 text-white text-[11px] font-medium hover:bg-orange-700 disabled:opacity-40" onClick={() => act(i, 'pay')}>
                          Pay
                        </button>
                      )}
                      {i.can_settle && (
                        <span className="inline-flex items-center gap-0.5">
                          {i.remaining > 0 && (
                            <button type="button" title="Send payment reminder" data-testid="pay-remind" disabled={busy === i.game_id}
                              className="p-1 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-40" onClick={() => act(i, 'remind')}>
                              <BellRing size={14} />
                            </button>
                          )}
                          <button type="button" title={i.remaining > 0 ? 'Due settled offline' : 'Excess returned offline'} data-testid="pay-settle" disabled={busy === i.game_id}
                            className="px-2 py-1 rounded bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-40" onClick={() => act(i, 'settle')}>
                            Settle
                          </button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
