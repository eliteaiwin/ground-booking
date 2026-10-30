import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Sparkles, LogIn, Hourglass, UserPlus, ArrowUpCircle, ArrowDownCircle, LogOut, UserMinus, PlayCircle, Flag,
  XCircle, Award, Trophy, Banknote, CreditCard, CheckCircle, Bell, Undo2, ArrowUp, ArrowDown, Activity, User,
  type LucideIcon, CheckCheck, CircleSlash, Copy,
} from 'lucide-react';
import { api } from '../services/api';
import { PlayerAvatar } from './PlayerAvatar';

export interface GameLogEntry {
  kind: string;
  at: string;
  description: string;
  user_id: number;
  user_name: string;
  profile_pic?: string | null;
  gender?: string | null;
}

const EVENTS: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  created: { icon: Sparkles, label: 'Initiated', color: 'text-purple-600' },
  cloned: { icon: Copy, label: 'Cloned', color: 'text-green-600' },
  joined: { icon: LogIn, label: 'Joined', color: 'text-green-600' },
  availability_confirmed: { icon: CheckCircle, label: 'Confirmed', color: 'text-green-600' },
  waiting: { icon: Hourglass, label: 'Waiting list', color: 'text-amber-600' },
  nominated: { icon: UserPlus, label: 'Added', color: 'text-green-600' },
  nominated_waiting: { icon: Hourglass, label: 'Waiting list', color: 'text-amber-600' },
  pay_first: { icon: Hourglass, label: 'Pays first', color: 'text-amber-600' },
  admitted: { icon: LogIn, label: 'Joined', color: 'text-green-600' },
  promoted: { icon: ArrowUpCircle, label: 'Moved up', color: 'text-green-600' },
  demoted: { icon: ArrowDownCircle, label: 'Moved down', color: 'text-amber-600' },
  quit: { icon: LogOut, label: 'Quit', color: 'text-red-600' },
  quit_waiting: { icon: LogOut, label: 'Quit', color: 'text-red-600' },
  removed: { icon: UserMinus, label: 'Removed', color: 'text-red-600' },
  played_added: { icon: UserPlus, label: 'Played', color: 'text-green-600' },
  played_removed: { icon: UserMinus, label: 'Not played', color: 'text-red-600' },
  started: { icon: PlayCircle, label: 'Started', color: 'text-blue-600' },
  completed: { icon: Flag, label: 'Completed', color: 'text-blue-600' },
  cancelled: { icon: XCircle, label: 'Cancelled', color: 'text-red-600' },
  potd_open: { icon: Award, label: 'POTD voting', color: 'text-yellow-600' },
  potd_final: { icon: Trophy, label: 'POTD', color: 'text-yellow-600' },
  paid: { icon: Banknote, label: 'Paid', color: 'text-emerald-600' },
  paid_online: { icon: CreditCard, label: 'Paid online', color: 'text-emerald-600' },
  marked_paid: { icon: CheckCircle, label: 'Marked paid', color: 'text-emerald-600' },
  settled: { icon: CheckCircle, label: 'Settled', color: 'text-emerald-600' },
  excess_settled: { icon: Undo2, label: 'Excess returned', color: 'text-emerald-600' },
  reminder: { icon: Bell, label: 'Reminder', color: 'text-orange-500' },
  received: { icon: CheckCheck, label: 'Received', color: 'text-emerald-600' },
  not_received: { icon: CircleSlash, label: 'Not received', color: 'text-red-600' },
  refund: { icon: Undo2, label: 'Refund', color: 'text-red-600' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `at` is already in the grounds' local time ("2026-10-13T19:00:00"), so format it without timezone shifts. */
export const logDateTime = (at: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(at);
  if (!m) return '';
  const hour = Number(m[4]);
  return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]} ${hour % 12 || 12}:${m[5]}:${m[6] ?? '00'} ${hour < 12 ? 'AM' : 'PM'}`;
};

type SortKey = 'event' | 'player' | 'description' | 'date';

export default function GameLog({ gameId }: { gameId: number }) {
  const [rows, setRows] = useState<GameLogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'date', asc: true });

  useEffect(() => {
    api.getGameLog(gameId).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the log'));
  }, [gameId]);

  const sorted = useMemo(() => {
    const value = (r: GameLogEntry): string => {
      switch (sort.key) {
        case 'event': return EVENTS[r.kind]?.label ?? r.kind;
        case 'player': return r.user_name;
        case 'description': return r.description;
        default: return r.at;
      }
    };
    return [...(rows ?? [])].sort((a, b) => {
      const c = sort.key === 'date' ? a.at.localeCompare(b.at) : value(a).localeCompare(value(b), undefined, { sensitivity: 'base' });
      return (sort.asc ? c : -c) || a.at.localeCompare(b.at);
    });
  }, [rows, sort]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">Nothing has happened yet</p>;

  const head = (key: SortKey, label: ReactNode, className = '') => (
    <th className={`py-1.5 px-1 font-medium text-gray-500 ${className}`}>
      <button type="button" onClick={() => setSort(s => ({ key, asc: s.key === key ? !s.asc : true }))}
        className="inline-flex items-center gap-0.5" data-testid={`log-sort-${key}`}>
        {label}
        {sort.key === key && (sort.asc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto -mx-1" data-testid="game-log">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left">
            {head('event', <Activity size={12} aria-label="Event" />, 'w-6')}
            {head('player', <User size={12} aria-label="Player" />, 'w-7')}
            {head('description', 'Description')}
            {head('date', 'Date', 'w-[74px]')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const ev = EVENTS[r.kind] ?? { icon: Sparkles, label: r.kind, color: 'text-gray-500' };
            const Icon = ev.icon;
            return (
              <tr key={`${r.at}-${r.kind}-${i}`} className="border-b last:border-0 align-top">
                <td className="py-1.5 px-1" title={ev.label}><Icon size={16} className={ev.color} /></td>
                <td className="py-1.5 px-1" title={r.user_name}>
                  <PlayerAvatar photo={r.profile_pic} gender={r.gender} alt={r.user_name} />
                </td>
                <td className="py-1.5 px-1 text-gray-800">{r.description}</td>
                <td className="py-1.5 px-1 text-[10px] text-gray-500 leading-tight whitespace-nowrap">{logDateTime(r.at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
