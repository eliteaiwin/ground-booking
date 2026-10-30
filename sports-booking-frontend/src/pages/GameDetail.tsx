import { useState, useEffect, useCallback, useRef } from 'react';
import { SportTile } from '@/components/SportTile';
import { formatPhone, setPhoneHomeCountry } from '@/lib/phone';
import { useAuth } from '../context/AuthContext';
import { FeeBreakdownTable } from '@/components/CostBreakdown';
import { computeFeeBreakdown, type FeeBreakdown, type FeeSettings } from '@/lib/fees';
import { openCashfreeCheckout } from '@/lib/cashfree';
import { api } from '../services/api';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Trophy, Users, Clock, MapPin, Phone, Star, Share2, MessageCircle, Bell, AlertTriangle, CreditCard, GripVertical, CheckCircle, Archive, Info, Banknote, Pencil, XCircle, Wallet, Trash2, Search, Plus, Copy, X, Check, Undo2 } from 'lucide-react';
import Discussion from './Discussion';
import CompleteGameDialog from './CompleteGameDialog';
import EditCompletedGameDialog from './EditCompletedGameDialog';
import { Player, formatPlayerDisplay } from '@/lib/player';
import { pitchLabel } from '@/lib/grounds';
import PlayerProfileDialog from '@/components/PlayerProfileDialog';
import { formatMoney, shareChangeText, currencySymbol } from '@/lib/currency';
import CurrencyIcon from '@/components/CurrencyIcon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InviteDialog } from '@/components/InviteDialog';
import { inviteUrl } from '@/lib/invite';
import MarkPaidDialog, { ProofViewer } from '@/components/MarkPaidDialog';
import PaymentCollectionChoice from '@/components/PaymentCollectionChoice';
import GameLog from '@/components/GameLog';
import { PayTo, ReceiverSelect, type PublicReceiver } from '@/components/PaymentReceiver';

const sportIconSmall = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
};

interface Team {
  id: number;
  team_name: string;
  team_order: number;
  jersey_color?: string;
}

const JERSEY_COLORS = ['Blue', 'Green', 'Yellow', 'Red', 'White', 'Black', 'Blue/Black', 'Black/White', 'Bibs - Green or Red'];
/** Blue and Black look alike on the pitch, so they count as one shade. */
const jerseyShades = (c: string) => c.replace('Bibs - ', '').replace(' or ', '/').split('/')
  .filter(Boolean).map(p => (p === 'Blue' || p === 'Black' ? 'Dark' : p));
const jerseysClash = (a: string, b: string) => jerseyShades(a).some(s => jerseyShades(b).includes(s));
const JERSEY_HEX: Record<string, string> = {
  Blue: '#2563eb', Green: '#16a34a', Yellow: '#facc15', Red: '#dc2626', White: '#ffffff', Black: '#111827',
};

function JerseySwatch({ color }: { color?: string }) {
  if (!color) return null;
  const [a, b = a] = color.replace('Bibs - ', '').replace(' or ', '/').split('/').map(c => JERSEY_HEX[c] || '#9ca3af');
  return <span className="inline-block w-3.5 h-3.5 rounded-full border border-gray-400 shrink-0"
    style={{ background: `linear-gradient(90deg, ${a} 50%, ${b} 50%)` }} aria-hidden />;
}

function JerseyPicker({ value, taken, onChange, testId }: { value: string; taken: string[]; onChange: (v: string) => void; testId?: string }) {
  return (
    <Select value={value || 'none'} onValueChange={v => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-40 shrink-0" data-testid={testId}><SelectValue placeholder="Jersey" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No jersey</SelectItem>
        {JERSEY_COLORS.filter(c => c === value || !taken.some(t => jerseysClash(c, t))).map(c => (
          <SelectItem key={c} value={c}><span className="flex items-center gap-2"><JerseySwatch color={c} /> {c}</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NOMINATION_COLOR = { self: 'text-green-600', moderator: 'text-blue-600' } as const;

const longDateTime = (ts?: string | null): string => {
  if (!ts) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(' ', 'T')}Z`);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()}-${d.toLocaleString('en-US', { month: 'short' })} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function nomination(player: Player): { tone: keyof typeof NOMINATION_COLOR; text: string } {
  const who = player.display_name || player.name.split(' ')[0];
  const when = longDateTime(player.joined_at);
  const on = when ? ` on ${when}` : '';
  if (player.nominated_by != null && player.nominated_by !== player.user_id) {
    return { tone: 'moderator', text: `Moderator ${player.nominated_by_name || 'someone'} nominated ${who}${on}` };
  }
  return { tone: 'self', text: `${who} nominated self${on}` };
}

// Tap (or hover on desktop) shows who nominated the player and when; the photo opens the player popup.
// green = self-nominated, blue = nominated by a moderator.
function PlayerInfoButton({ player }: { player: Player }) {
  const { tone, text: info } = nomination(player);
  const [tip, setTip] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!tip) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setTip(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [tip]);
  return (
    <span ref={ref} className="relative inline-flex" onPointerEnter={e => e.pointerType === 'mouse' && setTip(true)} onPointerLeave={e => e.pointerType === 'mouse' && setTip(false)}>
      <button
        type="button"
        data-testid="player-info"
        aria-label="Nomination details"
        className={`transition-colors ${NOMINATION_COLOR[tone]}`}
        onClick={() => setTip(t => !t)}
      >
        <Info size={14} />
      </button>
      {tip && info && (
        <span role="tooltip" className="absolute right-0 bottom-full mb-1 z-20 w-56 rounded bg-gray-900 text-white text-xs px-2 py-1 shadow">
          {info}
        </span>
      )}
    </span>
  );
}

function timeToStart(date: string, time: string): string {
  const mins = Math.round((new Date(`${date}T${time || '00:00'}`).getTime() - Date.now()) / 60000);
  if (isNaN(mins)) return 'Are you sure you want to cancel this game?';
  if (mins <= 0) return 'The game has already started. Are you sure you want to cancel?';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hour${h > 1 ? 's' : ''}`, !d && m && `${m} minute${m > 1 ? 's' : ''}`].filter(Boolean);
  return `${parts.join(' ')} to start the game. Are you sure you want to cancel?`;
}

// Red x removes the player; grey x means this user can't remove them.
function RemovePlayerButton({ allowed, paid, onRemove }: { allowed: boolean; paid?: boolean; onRemove: () => void }) {
  if (allowed && paid) {
    return (
      <button type="button" aria-label="Already paid" title="Already paid – can't remove" data-testid="remove-player-paid"
        onClick={() => window.alert("This player has already paid, so their name can't be removed.")} className="text-gray-300">
        <X size={15} />
      </button>
    );
  }
  return allowed ? (
    <button type="button" aria-label="Remove player" data-testid="remove-player" onClick={onRemove} className="text-red-500 hover:text-red-700">
      <X size={15} />
    </button>
  ) : (
    <span title="You can't remove this player" data-testid="remove-player-disabled" className="text-gray-300 cursor-not-allowed">
      <X size={15} />
    </span>
  );
}

const shortDateTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Tap tooltip: only one open at a time, closes on a tap anywhere outside it.
let tipSeq = 0;
function useTip() {
  const [tip, setTipState] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useRef(0);
  if (!id.current) id.current = ++tipSeq;
  useEffect(() => {
    if (!tip) return;
    window.dispatchEvent(new CustomEvent('tip-open', { detail: id.current }));
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== id.current) setTipState(false); };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setTipState(false); };
    window.addEventListener('tip-open', onOther);
    document.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('tip-open', onOther); document.removeEventListener('pointerdown', onDown); };
  }, [tip]);
  return [tip, setTipState, ref] as const;
}

// Cash icon beside a player: red = due, green = paid, amber = paid too little or too much.
// Hover (desktop) or tap (phone) shows the details.
function PaymentIcon({ pd, confirmed, due, currency, onSettle, onViewProof, hasReceiver = false, onReceived }: {
  pd?: PaymentDetail; confirmed: boolean; due: boolean; currency: string; onSettle?: (amount: string) => void; onViewProof?: () => void;
  hasReceiver?: boolean; onReceived?: (ok: boolean) => void;
}) {
  const [tip, setTip, tipRef] = useTip();
  const paid = pd?.paid_amount || 0;
  const online = pd?.paid_via === 'online';
  const received = hasReceiver && paid > 0 && (online || (pd?.received_amount || 0) >= paid - 0.001);
  const excess = pd?.excess || 0;
  const pending = pd?.pending || 0;
  const rs = (n: number) => `${formatMoney(Math.ceil(n - 0.001), currency)}`;
  let color = 'text-gray-300';
  let text = 'No payment yet';
  const refund = !!pd?.refund_due && paid > 0;
  if (refund) {
    color = 'text-purple-600';
    text = `Game cancelled: refund of ${rs(paid)} due. Offline settlement to be done by the Payment Receiver.`;
  } else if (pd && excess > 0) {
    color = 'text-amber-500';
    text = `Paid ${rs(paid)}, excess ${rs(excess)}. Share is ${rs(pd.amount)}.`;
  } else if (pd && paid > 0 && pending > 0) {
    color = 'text-amber-500';
    text = `Paid ${rs(paid)}, remaining ${rs(pending)}. Share is ${rs(pd.amount)}.`;
  } else if ((pd && pending <= 0 && paid > 0) || confirmed) {
    color = 'text-green-600';
    const when = shortDateTime(pd?.paid_at);
    if (pd?.paid_via === 'moderator') text = `Moderator ${pd.paid_by_name || ''} marked it as paid${when ? ` on ${when}` : ''}`.replace('  ', ' ');
    else if (pd?.paid_via === 'online') text = `Paid ${rs(paid)} online by Self${when ? ` on ${when}` : ''}`;
    else if (pd?.paid_via === 'self') text = `Paid ${rs(paid)} by Self${when ? ` on ${when}` : ''}`;
    else text = pd ? `Paid ${rs(paid)}${when ? ` on ${when}` : ''}` : 'Paid';
  } else if (pd && pending > 0 && due) {
    color = 'text-red-500';
    text = `Due ${rs(pending)}`;
  } else if (pd && pending > 0) {
    text = `${rs(pending)} to pay after the game`;
  }
  return (
    <span ref={tipRef} className="relative inline-flex" onPointerEnter={(e) => { if (e.pointerType === 'mouse') setTip(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(false); }}>
      <button type="button" className={color} data-testid="payment-icon" aria-label={text} onClick={() => setTip(t => !t)}>
        <span className="relative inline-flex">
          {refund ? <Undo2 size={16} data-testid="refund-icon" /> : <Banknote size={16} />}
          {received && !refund && (
            <span className="absolute -top-1.5 -right-1.5 bg-green-600 text-white rounded-full p-[1px]" data-testid="received-tick">
              <Check size={8} strokeWidth={4} />
            </span>
          )}
        </span>
      </button>
      {tip && (
        <span role="tooltip" onClick={() => setTip(false)} className="absolute right-0 top-full mt-1 z-20 w-56 rounded bg-gray-900 text-white text-xs px-2 py-1 shadow">
          {text}
          {received && !online && !refund && (
            <span className="block mt-1 text-green-300" data-testid="received-note">
              ✓ {pd?.received_by_name?.split(' ')[0] || 'The receiver'} verified the receiving of payment too.
            </span>
          )}
          {onReceived && paid > 0 && !received && (
            <span className="flex gap-2 mt-1">
              <button type="button" className="px-2 py-0.5 rounded bg-green-600 font-medium" data-testid="confirm-received"
                onClick={(e) => { e.stopPropagation(); setTip(false); onReceived(true); }}>Received ✓</button>
              <button type="button" className="px-2 py-0.5 rounded bg-red-600 font-medium" data-testid="not-received"
                onClick={(e) => { e.stopPropagation(); setTip(false); onReceived(false); }}>Not received</button>
            </span>
          )}
          {pd?.has_proof && onViewProof && (
            <button type="button" className="block mt-1 underline font-medium text-green-300" data-testid="view-proof"
              onClick={(e) => { e.stopPropagation(); setTip(false); onViewProof(); }}>
              View payment screenshot
            </button>
          )}
          {excess > 0 && onSettle && (
            <button type="button" className="block mt-1 underline font-medium text-amber-300"
              onClick={(e) => { e.stopPropagation(); setTip(false); onSettle(String(Math.ceil(excess - 0.001))); }}>
              Settle (returned offline)
            </button>
          )}
        </span>
      )}
    </span>
  );
}

const PREF_LABEL = ['', '1st', '2nd', '3rd'];

// POTD points badge; hover (desktop) or tap (phone) shows how the points add up.
// Lists every voter with their preference and points.
function PotdPointsBadge({ result }: { result: POTDResult }) {
  const [tip, setTip, tipRef] = useTip();
  const counts = ([[1, result.first_pref, 3], [2, result.second_pref, 2], [3, result.third_pref, 1]] as const)
    .filter(([, n]) => n > 0);
  return (
    <span ref={tipRef} className="relative inline-flex" onPointerEnter={(e) => { if (e.pointerType === 'mouse') setTip(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(false); }}>
      <button type="button" data-testid="potd-points" onClick={() => setTip(t => !t)}>
        <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-300">
          <Star size={10} className="mr-0.5" />{result.points} pts
        </Badge>
      </button>
      {tip && (
        <span role="tooltip" onClick={() => setTip(false)} className="absolute right-0 top-full mt-1 z-20 w-56 rounded bg-gray-900 text-white text-xs px-2 py-1.5 shadow">
          <span className="block font-semibold mb-1">POTD votes</span>
          {result.voters
            ? result.voters.map(v => (
              <span key={`${v.voter_id}-${v.preference}`} className="flex justify-between gap-2">
                <span className="truncate">{v.voter_name}: {PREF_LABEL[v.preference]}</span><span>{v.points} pts</span>
              </span>
            ))
            : counts.map(([pref, n, pts]) => (
              <span key={pref} className="flex justify-between gap-2">
                <span>{PREF_LABEL[pref]} choice × {n}</span><span>{n * pts} pts</span>
              </span>
            ))}
          <span className="flex justify-between gap-2 border-t border-gray-600 mt-1 pt-1 font-semibold">
            <span>Total</span><span>{result.points} pts</span>
          </span>
          <span className="block text-gray-400 mt-1">1st = 3 pts, 2nd = 2 pts, 3rd = 1 pt</span>
        </span>
      )}
    </span>
  );
}

interface PaymentDetail {
  user_id: number;
  name: string;
  status: string;
  amount: number;
  paid_amount: number;
  pending: number;
  excess?: number;
  paid_at: string | null;
  paid_by?: number | null;
  paid_by_name?: string;
  paid_via?: string;
  has_proof?: boolean;
  received_amount?: number;
  received_by_name?: string;
  refund_due?: boolean;
}

interface Game {
  ground_country_code?: string;
  id: number;
  game_code: string;
  title: string;
  sport_type: string;
  ground_name: string;
  pitch_format: string;
  pitch_number: number;
  game_date: string;
  game_time: string;
  max_players: number;
  cost_per_person: number;
  currency?: string;
  base_ground_cost: number;
  ground_cost: number;
  per_person_amount: number;
  payments_enabled: boolean;
  payment_surcharge_percent: number;
  payment_gst_percent?: number;
  payment_commission_percent?: number;
  payment_app_fee_gst_percent?: number;
  payment_collection?: string;
  online_payment_ready?: boolean;
  fee_breakdown?: FeeBreakdown | null;
  ground_confirmed?: boolean;
  moderator_group_name?: string | null;
  payment_mode?: string;
  payment_timing: string;
  status: string;
  quit_penalty_hours: number;
  duration_minutes: number;
  is_archived: boolean;
  is_past?: boolean;
  roster_locked?: boolean;
  roster_edit_days?: number;
  late_quit_hours?: number;
  late_quit_now?: boolean;
  allow_position_selection?: boolean;
  ground_map_url?: string;
  show_quit_penalty?: boolean;
  pay_first_enabled?: boolean;
  awaiting_payment?: (Player & { due?: number })[];
  payee: { id: number; name: string; phone: string } | null;
  receiver?: PublicReceiver | null;
  is_receiver?: boolean;
  created_by: number;
  created_by_name: string;
  created_at?: string;
  selected_players: Player[];
  waiting_list: Player[];
  teams: Team[];
  payment_summary: { total: number; paid: number; pending: number };
  payment_details: PaymentDetail[];
  player_of_the_day: { player_id: number; name: string; votes: number } | null;
  game_score: {
    team_a_id: number | null; team_a_name: string; team_a_score: number;
    team_b_id: number | null; team_b_name: string; team_b_score: number;
  } | null;
  goal_scorers: { user_id: number; name: string; display_name?: string; phone: string; goals: number; own_goals: number }[];
  note_before_players: string;
  note_after_players: string;
}

interface UserItem {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  phone: string;
  email?: string;
  profile_pic?: string;
  roles: string[];
}

interface POTDResult {
  player_id: number;
  name: string;
  first_name: string;
  points: number;
  total_votes: number;
  first_pref: number;
  second_pref: number;
  third_pref: number;
  tied?: boolean;
  voters?: { voter_id: number; voter_name: string; preference: number; points: number }[];
}

interface POTDData {
  results: POTDResult[];
  man_of_the_match: { player_id: number; name: string; points: number; tied: boolean; players?: POTDResult[] } | null;
  my_votes: { player_id: number; preference: number }[];
  voting_open: boolean;
  voting_deadline: string | null;
}

const statusColor = (status: string) => {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700';
    case 'voting_open': return 'bg-green-100 text-green-700';
    case 'in_progress': return 'bg-blue-100 text-blue-700';
    case 'completed': return 'bg-purple-100 text-purple-700';
    case 'cancelled': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'draft': return 'Draft';
    case 'voting_open': return 'Open for Nomination';
    case 'in_progress': return 'Game Started';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
};

interface Props {
  gameId: number;
  onBack: () => void;
}

function TentativeBadge() {
  return (
    <span title="Tentative" data-testid="tentative-badge"
      className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold align-middle">T</span>
  );
}

export default function GameDetail({ gameId, onBack }: Props) {
  const { user, isAdmin, isModerator, isGroundManagement, isReadOnly } = useAuth();
  useEffect(() => () => setPhoneHomeCountry(), []);
  const [game, setGame] = useState<Game | null>(null);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [potdFirstPref, setPotdFirstPref] = useState('');
  const [potdSecondPref, setPotdSecondPref] = useState('');
  const [potdThirdPref, setPotdThirdPref] = useState('');
  const [potdResults, setPotdResults] = useState<POTDResult[]>([]);
  const [potdMyVotes, setPotdMyVotes] = useState<{ player_id: number; preference: number }[]>([]);
  const [potdVotingOpen, setPotdVotingOpen] = useState(true);
  const [potdDeadline, setPotdDeadline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [showEditGame, setShowEditGame] = useState(false);
  const [confirmCompleted, setConfirmCompleted] = useState<'edit' | 'delete' | null>(null);
  const [editPayeeUserId, setEditPayeeUserId] = useState('');
  const [editReceiverId, setEditReceiverId] = useState('0');
  const [editQuitPenalty, setEditQuitPenalty] = useState('0');
  const [editPaymentMode, setEditPaymentMode] = useState('postpaid');
  const [editPaymentCollection, setEditPaymentCollection] = useState('offline');
  const [proofGameOpen, setProofGameOpen] = useState(false);
  const [payPreview, setPayPreview] = useState<FeeBreakdown | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const [showRemind, setShowRemind] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [editGroundCost, setEditGroundCost] = useState('');
  const [editNoteBefore, setEditNoteBefore] = useState('');
  const [editNoteAfter, setEditNoteAfter] = useState('');
  const [teamCount, setTeamCount] = useState('2');
  const [teamNames, setTeamNames] = useState<string[]>(['Team A', 'Team B']);
  const [teamColors, setTeamColors] = useState<string[]>(['', '']);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [dragPlayer, setDragPlayer] = useState<Player | null>(null);
  const [quitPenaltyInfo, setQuitPenaltyInfo] = useState<{has_penalty: boolean; must_pay: boolean; hours_until_game?: number; quit_penalty_hours?: number} | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [lateQuitWarning, setLateQuitWarning] = useState<'' | 'wl' | 'declined'>('');
  const [showJoinConfirm, setShowJoinConfirm] = useState(false);
  const [joinTentative, setJoinTentative] = useState(false);
  const [firstTimeAlert, setFirstTimeAlert] = useState<string | null>(null);
  const [showCancelPreview, setShowCancelPreview] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addPlayerSearch, setAddPlayerSearch] = useState('');
  const [addingPlayerId, setAddingPlayerId] = useState<number | null>(null);
  const [cancelPreview, setCancelPreview] = useState<{
    confirmed_players: number; total_players: number; paid_players: number; refund_amount: number;
    unverified_paid?: string[]; receiver_name?: string;
    title: string; ground_name: string; game_date: string; game_time: string;
  } | null>(null);
  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [teamAScore, setTeamAScore] = useState(0);
  const [teamBScore, setTeamBScore] = useState(0);
  const [goalScorers, setGoalScorers] = useState<Record<number, number>>({});
  const [scoreStep, setScoreStep] = useState<'scores' | 'scorers'>('scores');
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showEditResultDialog, setShowEditResultDialog] = useState(false);
  const [pendingPlayedUserIds, setPendingPlayedUserIds] = useState<number[] | null>(null);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  // A player who still owes on a completed game sees Payment Details ticked (with their Mark as paid); once paid it goes back to unticked.
  const myDue = !!game && game.status === 'completed'
    && game.selected_players.some(p => p.user_id === user?.id && p.payment_confirmed !== 1);
  const myDueKey = game ? `${game.id}:${myDue}` : '';
  const lastDueKey = useRef('');
  useEffect(() => {
    if (!myDueKey || myDueKey === lastDueKey.current) return;
    lastDueKey.current = myDueKey;
    setShowPaymentDetails(myDue);
  }, [myDueKey, myDue]);
  const [playersTab, setPlayersTab] = useState<'current' | 'log'>('current');
  const [markPaidPlayerId, setMarkPaidPlayerId] = useState<number | null>(null);
  const [markPaidComment, setMarkPaidComment] = useState('');
  const [profileUserId, setProfileUserId] = useState<number | null>(null);

  const currency = currencySymbol(game?.currency || user?.currency);

  useEffect(() => {
    loadGame();
  }, [gameId]);

  const loadGame = async () => {
    try {
      const [gameData, usersData] = await Promise.all([
        api.getGame(gameId),
        api.listUsers().catch(() => []),
      ]);
      setPhoneHomeCountry(gameData.ground_country_code); setGame(gameData);
      setAllUsers(usersData);
      if (gameData.status === 'completed') {
        try {
          const potd: POTDData = await api.getPOTD(gameId);
          setPotdResults(potd.results || []);
          setPotdMyVotes(potd.my_votes || []);
          setPotdVotingOpen(potd.voting_open !== false);
          setPotdDeadline(potd.voting_deadline || null);
          // Pre-fill existing votes
          if (potd.my_votes && potd.my_votes.length > 0) {
            const v1 = potd.my_votes.find(v => v.preference === 1);
            const v2 = potd.my_votes.find(v => v.preference === 2);
            const v3 = potd.my_votes.find(v => v.preference === 3);
            if (v1) setPotdFirstPref(String(v1.player_id));
            if (v2) setPotdSecondPref(String(v2.player_id));
            if (v3) setPotdThirdPref(String(v3.player_id));
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const myAwaiting = game?.awaiting_payment?.find(p => p.user_id === user?.id);
  const isPlayerInGame = game?.selected_players.some(p => p.user_id === user?.id) ||
    game?.waiting_list.some(p => p.user_id === user?.id) || !!myAwaiting;
  const isSelectedPlayer = game?.selected_players.some(p => p.user_id === user?.id);
  const myPlayerRecord = game?.selected_players.find(p => p.user_id === user?.id);
  const myTentative = !!(myPlayerRecord?.tentative || game?.waiting_list.find(p => p.user_id === user?.id)?.tentative) && game?.status !== 'completed';

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-context-menu]')) setMarkPaidPlayerId(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const openProfile = (userId: number) => setProfileUserId(userId);

  const payOnline = (gameId: number) =>
    handleAction('pay', async () => {
      const order = await api.createPaymentOrder(gameId);
      const sdkError = await openCashfreeCheckout(order);
      const result = await api.verifyPaymentOrder(order.order_id);
      if (result.status !== 'paid') {
        throw new Error(sdkError || 'Payment not completed. If money was deducted, it will update here automatically.');
      }
    });

  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
    setActionLoading(action);
    setError('');
    try {
      await fn();
      await loadGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleDelete = async () => {
    setActionLoading('delete');
    setError('');
    try {
      await api.deleteGame(game!.id);
      setShowDeleteConfirm(false);
      onBack();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleEditResult = async (payload: {
    played_user_ids: number[];
    team_scores?: { team_id: number; score: number }[];
    team_assignments?: Record<number, number | null>;
    goal_scorers?: { user_id: number; goals: number; own_goals: number }[];
  }) => {
    await handleAction('edit-result', () => api.editCompletedGame(game!.id, payload));
    setShowEditResultDialog(false);
  };

  const handleQuitClick = async () => {
    const confirmed = !!game?.selected_players.some(p => p.user_id === user?.id);
    if (game?.late_quit_now && confirmed && !(isModerator || isAdmin)) {
      setShowQuitConfirm(false);
      setLateQuitWarning(game.waiting_list.length ? 'wl' : 'declined');
      return;
    }
    if (confirmed && game?.status === 'in_progress' && game?.quit_penalty_hours > 0) {
      try {
        const info = await api.checkQuitPenalty(game.id);
        setQuitPenaltyInfo(info);
        setShowQuitConfirm(true);
      } catch {
        setShowQuitConfirm(true);
      }
    } else {
      setQuitPenaltyInfo(null);
      setShowQuitConfirm(true);
    }
  };

  const confirmQuit = () => {
    setShowQuitConfirm(false);
    handleAction('quit', () => api.quitGame(game!.id));
  };

  const handlePlayersSelected = (playedUserIds: number[]) => {
    if (game?.sport_type === 'soccer' && game?.teams.length >= 2) {
      setPendingPlayedUserIds(playedUserIds);
      setTeamAScore(0);
      setTeamBScore(0);
      setGoalScorers({});
      setScoreStep('scores');
      setShowScoreDialog(true);
    } else {
      handleAction('complete', () => api.completeGame(game!.id, { played_user_ids: playedUserIds }));
    }
  };

  const handleCreateTeams = async () => {
    const names = teamNames.slice(0, parseInt(teamCount));
    await handleAction('create-teams', () => api.createTeams(game!.id, names, teamColors.slice(0, names.length)));
  };

  const handleMovePlayer = async (playerUserId: number, teamId: number | null) => {
    await handleAction('move-player', () => api.movePlayerToTeam(game!.id, playerUserId, teamId));
  };

  const handleDeleteTeams = async () => {
    await handleAction('delete-teams', () => api.deleteTeams(game!.id));
  };

  const handleTeamCountChange = (val: string) => {
    const count = parseInt(val);
    setTeamCount(val);
    const names = [...teamNames];
    const labels = ['Team A', 'Team B', 'Team C', 'Team D'];
    while (names.length < count) names.push(labels[names.length] || `Team ${names.length + 1}`);
    setTeamNames(names.slice(0, count));
    setTeamColors(c => [...c, '', '', '', ''].slice(0, count));
  };

  const handleDragStart = useCallback((player: Player) => {
    setDragPlayer(player);
  }, []);

  const handleDrop = useCallback((teamId: number | null) => {
    if (dragPlayer) {
      handleMovePlayer(dragPlayer.user_id, teamId);
      setDragPlayer(null);
    }
  }, [dragPlayer]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const canCreateTeams = game && (isAdmin || isModerator) &&
    (game.status === 'voting_open' || game.status === 'in_progress') &&
    game.selected_players.length >= Math.ceil(game.max_players * 0.7);

  const formatGameDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
    } catch {
      return dateStr;
    }
  };

  const formatTime12h = (timeStr: string) => {
    try {
      const [h, m] = timeStr.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  const getReportingTime = (timeStr: string) => {
    try {
      const [h, m] = timeStr.split(':').map(Number);
      let totalMin = h * 60 + m - 15;
      if (totalMin < 0) totalMin += 24 * 60;
      const rh = Math.floor(totalMin / 60);
      const rm = totalMin % 60;
      const ampm = rh >= 12 ? 'PM' : 'AM';
      const hour = rh % 12 || 12;
      return `${String(hour).padStart(2, '0')}:${String(rm).padStart(2, '0')} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  const generateStatusMsg = () => {
    const sportLabel = game!.sport_type.charAt(0).toUpperCase() + game!.sport_type.slice(1);
    const icon = sportIconSmall(game!.sport_type);
    const duration = game!.duration_minutes || 90;

    let msg = `Ground: ${game!.ground_name} (${sportLabel} - ${icon})\n`;
    msg += `Date: ${formatGameDate(game!.game_date)}\n`;
    msg += `Start Time: ${formatTime12h(game!.game_time)} (Duration: ${duration} mins)\n`;
    msg += `Reporting Time: ${getReportingTime(game!.game_time)}\n`;
    msg += `Per Person Cost: ${formatMoney(perPerson.toFixed(0), currency)}\n\n`;

    msg += `Confirmed:\n------------\n`;
    game!.selected_players.forEach((p, i) => {
      const paidMark = p.payment_confirmed === 1 ? ' \u2705' : '';
      msg += `${i + 1}. ${formatPlayerDisplay(p.name, p.phone, undefined, p.display_name)}${p.position && p.position !== 'Anywhere' ? ` (${p.position})` : ''}${paidMark}\n`;
    });

    if (game!.waiting_list.length > 0) {
      msg += `\nWaiting List:\n-------------\n`;
      game!.waiting_list.forEach((p, i) => {
        msg += `${i + 1}. ${formatPlayerDisplay(p.name, p.phone, undefined, p.display_name)}${p.position && p.position !== 'Anywhere' ? ` (${p.position})` : ''}\n`;
      });
    }

    return msg + shareFooter();
  };

  const shareFooter = () =>
    `\n${game!.game_code ? `Game Ref: ${game!.game_code}\n` : ''}Open in Elite Turf Booking: ${inviteUrl(user?.id, game!.id)}`;

  const generateRemindMsg = () => {
    const g = game!;
    const per = g.per_person_amount ?? g.cost_per_person;
    const byUser = new Map((g.payment_details || []).map(pd => [pd.user_id, pd]));
    let msg = `Payment Reminder\n`;
    msg += `Ground: ${g.ground_name}${g.title ? ` (${g.title})` : ''}\n`;
    msg += `Date: ${formatGameDate(g.game_date)}, ${formatTime12h(g.game_time)}\n`;
    msg += `Per Person: ${formatMoney(per.toFixed(0), currency)}\n\n`;
    let paid = 0;
    let due = 0;
    g.selected_players.forEach((pl, i) => {
      const pd = byUser.get(pl.user_id);
      const pending = pd ? Math.max(0, Math.ceil(pd.pending - 0.001)) : 0;
      const isPaid = !!pd && pending === 0;
      if (isPaid) paid += 1;
      due += pending;
      const name = formatPlayerDisplay(pl.name, pl.phone, undefined, pl.display_name);
      msg += `${i + 1}. ${isPaid ? '\u2705' : '\u2B1C'} ${name} - ${isPaid ? 'Paid' : `Due ${formatMoney(pending.toFixed(0), currency)}`}\n`;
    });
    msg += `\nPaid: ${paid}/${g.selected_players.length} | Pending: ${formatMoney(due.toFixed(0), currency)}\n`;
    if (g.receiver) msg += `\nPay to: ${g.receiver.nick_name}\n${g.receiver.methods.map(m => m.value).join('\n')}\n`;
    else if (g.payee) msg += `\nPay to: ${g.payee.name} (${formatPhone(g.payee.phone)})\n`;
    return msg + shareFooter();
  };

  const getTeamPlayers = (teamId: number) => game!.selected_players.filter(p => p.team_id === teamId);
  const getUnassignedPlayers = () => game!.selected_players.filter(p => !p.team_id);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} className="mr-1" /> Back</Button>
        <p className="text-center text-gray-500 mt-8">Game not found</p>
      </div>
    );
  }

  const availableForNomination = allUsers.filter(
    u => !game.selected_players.some(p => p.user_id === u.id) &&
      !game.waiting_list.some(p => p.user_id === u.id)
  );


  const paymentByUser = new Map((game.payment_details || []).map(p => [p.user_id, p]));
  const hasPaid = (uid?: number) => uid != null && (paymentByUser.get(uid)?.paid_amount || 0) > 0;
  const paidIds = new Set((game.payment_details || []).filter(p => (p.paid_amount || 0) > 0).map(p => p.user_id));
  const iPaid = hasPaid(user?.id);
  const unpaidPlayers = (game.payment_details || []).filter(pd => pd.pending > 0);
  const totalReceived = (game.payment_details || []).reduce((sum, p) => sum + (p.paid_amount || 0), 0);
  const perPerson = game.per_person_amount ?? game.cost_per_person;

  // Game times are in the ground's local time; check on the device too, since the server clock may be UTC.
  const gameIsOver = !!game.is_past ||
    Date.now() >= new Date(`${game.game_date}T${game.game_time}`).getTime() + (game.duration_minutes || 90) * 60000;
  const removableStage = ['draft', 'voting_open', 'in_progress'].includes(game.status) && !gameIsOver && !isReadOnly;
  const canRemove = (p: Player) => isModerator || isAdmin || p.user_id === user?.id || p.nominated_by === user?.id;
  const removePlayer = (p: Player) => {
    if (p.user_id === user?.id) { handleQuitClick(); return; }
    const name = p.display_name || p.name.split(' ')[0];
    if (window.confirm(`Are you sure you want to remove ${name}'s name?`)) {
      handleAction('remove', () => api.removePlayer(game.id, p.user_id));
    }
  };  const payOnlineAvailable = game.payment_collection === 'app' && !!game.online_payment_ready;
  const myPendingAmount = (game.payment_details || []).find(d => d.user_id === user?.id)?.pending ?? game.cost_per_person;
  const gameFees: FeeSettings = {
    fee_percent: game.payment_surcharge_percent,
    gst_percent: game.payment_gst_percent ?? 0,
    commission_percent: game.payment_commission_percent ?? 0,
    app_fee_gst_percent: game.payment_app_fee_gst_percent ?? 0,
  };
  const myFeeBreakdown = computeFeeBreakdown(myPendingAmount, gameFees);
  const myAwaitingFees = computeFeeBreakdown(myAwaiting?.due ?? perPerson, gameFees);
  const myPayment = (game.payment_details || []).find(d => d.user_id === user?.id);
  const myPaidSoFar = myPayment?.paid_amount || 0;
  const dueAmount = (n: number) => (game.payment_collection === 'app' ? computeFeeBreakdown(n, gameFees).total : Math.ceil(n - 0.001));
  const totalOutstanding = game.payment_details?.length
    ? game.payment_details.reduce((sum, p) => sum + p.amount, 0)
    : perPerson * game.selected_players.length;
  const pendingAmount = (game.payment_details || []).reduce((sum, p) => sum + (p.pending > 0 ? Math.ceil(p.pending - 0.001) : 0), 0);
  const excessAmount = (game.payment_details || []).reduce((sum, p) => sum + ((p.excess || 0) > 0 ? Math.ceil((p.excess || 0) - 0.001) : 0), 0);
  const allParticipants = [...game.selected_players, ...game.waiting_list];
  const playedParticipants = pendingPlayedUserIds
    ? allParticipants.filter(p => pendingPlayedUserIds.includes(p.user_id))
    : game.selected_players;

  const canEditGame = (isModerator || isAdmin) && game.status !== 'cancelled';
  const canDeleteGame = game.is_archived ? isAdmin : (isAdmin || isModerator || isGroundManagement) && !gameIsOver && (game.status === 'draft' || game.status === 'cancelled');
  const reveal = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  const openEditGame = () => {
    setEditPayeeUserId(game.payee ? String(game.payee.id) : '');
                setEditReceiverId(game.receiver ? String(game.receiver.id) : '0');
                setEditQuitPenalty(String(game.quit_penalty_hours || 0));
                setEditPaymentMode(game.payment_timing === 'before' ? 'prepaid' : 'postpaid');
                setEditPaymentCollection(game.payment_collection || 'offline');
                setEditGroundCost(String(game.ground_cost));
                setEditNoteBefore(game.note_before_players || '');
                setEditNoteAfter(game.note_after_players || '');
    setShowEditGame(true);
    reveal('edit-game');
  };
  const openDeleteGame = () => { setShowDeleteConfirm(true); reveal('delete-game'); };
  const completedAgo = () => {
    const end = new Date(`${game.game_date}T${game.game_time}`).getTime() + (game.duration_minutes || 90) * 60000;
    const d = Math.floor((Date.now() - end) / 86400000);
    return d <= 0 ? 'today' : `${d}d ago`;
  };
  const guardCompleted = (what: 'edit' | 'delete') => {
    if (game.status === 'completed') setConfirmCompleted(what);
    else if (what === 'edit') openEditGame();
    else openDeleteGame();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center mb-2">
            <button onClick={onBack} className="flex items-center gap-1 text-sm hover:underline">
              <ArrowLeft size={16} /> Back to Games
            </button>
            <div className="ml-auto flex items-center gap-1">
              {canEditGame && (
                <button type="button" onClick={() => guardCompleted('edit')} aria-label="Edit game" title="Edit game" data-testid="hdr-edit"
                  className="p-1.5 rounded-md hover:bg-white/20"><Pencil size={18} /></button>
              )}
              {canDeleteGame && (
                <button type="button" onClick={() => guardCompleted('delete')} aria-label="Delete game" title="Delete game" data-testid="hdr-delete"
                  className="p-1.5 rounded-md hover:bg-white/20"><Trash2 size={18} /></button>
              )}
            </div>
          </div>
          <Dialog open={!!confirmCompleted} onOpenChange={o => !o && setConfirmCompleted(null)}>
            <DialogContent className="max-w-sm" data-testid="completed-confirm">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle size={16} className="text-orange-500" /> Game already completed</DialogTitle></DialogHeader>
              <p className="text-sm text-gray-600">This game was completed {completedAgo()}. Do you want to {confirmCompleted === 'delete' ? 'delete' : 'modify'} it?</p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirmCompleted(null)}>No</Button>
                <Button className={confirmCompleted === 'delete' ? 'bg-red-700 hover:bg-red-800' : 'bg-green-600 hover:bg-green-700'}
                  onClick={() => { const w = confirmCompleted; setConfirmCompleted(null); if (w === 'delete') openDeleteGame(); else openEditGame(); }}>
                  Yes, {confirmCompleted === 'delete' ? 'delete' : 'modify'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-3">
            <SportTile sport={game.sport_type} className="w-12 h-12 ring-2 ring-white/60" />
            <div>
              <h1 className="text-xl font-bold">{game.ground_name}</h1>
              {game.title && <p className="text-sm font-medium text-white/90">{game.title}</p>}
              {game.game_code && <p className="text-xs font-mono text-white/70">{game.game_code}</p>}
              <div className="flex gap-2 mt-1 hide-when-compact">
                {(!game.is_archived || ['completed', 'cancelled'].includes(game.status)) && (
                  <Badge className={`${statusColor(game.status)} mt-1`}>{statusLabel(game.status)}</Badge>
                )}
                {game.is_archived && <Badge className="bg-gray-200 text-gray-700 mt-1"><Archive size={10} className="mr-1" /> Archived</Badge>}
                <a href={game.ground_map_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.ground_name)}`}
                  target="_blank" rel="noreferrer" data-testid="maps-link" aria-label="Open ground location in Google Maps" title="Open in Google Maps"
                  className="mt-1 inline-flex items-center justify-center w-7 h-7 rounded-md bg-white shadow-sm hover:scale-105 transition-transform">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Z" fill="#EA4335" />
                    <circle cx="12" cy="9" r="2.6" fill="#fff" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}
        {game.status !== 'cancelled' && !myAwaiting && (isSelectedPlayer || game.waiting_list.some(p => p.user_id === user?.id)) && (
          <div className="flex items-center justify-between gap-2 text-sm font-medium" data-testid="my-status-line">
            <span className={isSelectedPlayer ? 'text-green-700' : 'text-orange-700'}>
              {game.status === 'completed'
                ? (isSelectedPlayer ? '\u{1F389} You played it.' : 'You nominated but remained in WL')
                : (isSelectedPlayer ? '\u{1F389} You are playing' : 'You have nominated, WL')}
              {myTentative && ' (tentative)'}
            </span>
            {myTentative && !gameIsOver && !isReadOnly && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                disabled={actionLoading === 'confirm-avail'} data-testid="confirm-playing"
                onClick={() => handleAction('confirm-avail', () => api.confirmAvailability(game.id))}>
                I'm playing
              </Button>
            )}
            {['draft', 'voting_open', 'in_progress'].includes(game.status) && !gameIsOver && !isReadOnly && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs border-red-300 text-red-600 hover:bg-red-50"
                onClick={handleQuitClick} disabled={actionLoading === 'quit' || iPaid} data-testid="unjoin"
                title={iPaid ? "You've already paid, so you can't unjoin" : undefined}>
                {actionLoading === 'quit' ? 'Leaving...' : iPaid ? 'Paid – can’t unjoin' : 'Unjoin'}
              </Button>
            )}
          </div>
        )}

        {game.status === 'voting_open' && !gameIsOver && !isReadOnly && !isPlayerInGame && !myAwaiting && (
          <div className="flex items-center justify-between gap-2 text-sm font-medium" data-testid="join-line">
            <span className="text-gray-700">You haven't joined yet</span>
            <Button size="sm" className="h-7 px-4 text-xs bg-green-600 hover:bg-green-700" data-testid="join"
              disabled={actionLoading === 'vote'}
              onClick={() => { setJoinTentative(false); setShowJoinConfirm(true); }}>
              {actionLoading === 'vote' ? 'Joining...' : 'Join'}
            </Button>
          </div>
        )}
        {showJoinConfirm && game.status === 'voting_open' && !isPlayerInGame && (
          <Card className="border-green-300 bg-green-50" data-testid="join-confirm">
            <CardContent className="p-4">
              <h4 className="font-semibold text-green-800 mb-2">Join {game.title}?</h4>
              <label className="flex items-start gap-2 text-sm text-gray-700 mb-3">
                <input type="checkbox" className="mt-0.5 accent-amber-500" checked={joinTentative}
                  onChange={e => setJoinTentative(e.target.checked)} data-testid="join-tentative" />
                <span>
                  <span className="font-medium">Tentative</span> <TentativeBadge />
                  <span className="block text-xs text-gray-500">
                    You'll be asked to confirm a few hours before the game.
                    {(game.late_quit_hours ?? 0) > 0 && ` Less than ${game.late_quit_hours} hours before, you can't pull out unless someone on the waiting list takes your place, otherwise you still pay.`}
                  </span>
                </span>
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowJoinConfirm(false)}>Cancel</Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700" data-testid="join-yes"
                  disabled={actionLoading === 'vote'}
              onClick={async () => {
                setActionLoading('vote');
                setError('');
                try {
                  const result = await api.voteJoin(game.id, 'Anywhere', joinTentative);
                  setShowJoinConfirm(false);
                  if (result.is_first_time_on_ground) {
                    setFirstTimeAlert('This is your first time on this ground. Even though this is a PostPaid game, please pay in advance as a deposit.');
                  }
                  await loadGame();
                } catch (err: unknown) {
                  setError(err instanceof Error ? err.message : 'Action failed');
                } finally {
                  setActionLoading('');
                }
              }}>
                  {actionLoading === 'vote' ? 'Joining...' : 'Yes, join'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Game Score Display - for completed soccer games */}
        {game.status === 'completed' && game.game_score && (
          <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
            <CardContent className="p-4">
              <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                <Trophy size={16} /> Final Score
              </h4>
              <div className="flex items-center justify-center gap-4 mb-3">
                <div className="text-center">
                  <p className="text-sm font-medium text-green-700">{game.game_score.team_a_name}</p>
                  <p className="text-3xl font-bold text-green-800">{game.game_score.team_a_score}</p>
                </div>
                <span className="text-2xl font-bold text-green-400">-</span>
                <div className="text-center">
                  <p className="text-sm font-medium text-green-700">{game.game_score.team_b_name}</p>
                  <p className="text-3xl font-bold text-green-800">{game.game_score.team_b_score}</p>
                </div>
              </div>
              {game.goal_scorers.length > 0 && (
                <div className="border-t border-green-200 pt-2 mt-2">
                  <p className="text-xs font-semibold text-green-700 mb-1">Goal Scorers:</p>
                  <div className="space-y-1">
                    {game.goal_scorers.map(s => (
                      <div key={s.user_id} className="flex justify-between text-sm">
                        <span className="text-green-800">{formatPlayerDisplay(s.name, s.phone, undefined, s.display_name)}</span>
                        <span className="font-semibold text-green-700">
                          {s.goals} {s.goals === 1 ? 'goal' : 'goals'}
                          {s.own_goals > 0 && <span className="text-red-600 ml-1">({s.own_goals} own)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(isAdmin || isModerator) && game.status === 'completed' && (
                <Button
                  variant="outline"
                  className="w-full mt-3 border-green-700 text-green-700 hover:bg-green-50"
                  onClick={() => setShowEditResultDialog(true)}
                >
                  <Pencil size={16} className="mr-2" /> Edit Game Result
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {(isAdmin || isModerator) && game.status === 'completed' && !game.game_score && (
          <Button variant="outline" className="w-full border-green-700 text-green-700 hover:bg-green-50"
            data-testid="edit-who-played" onClick={() => setShowEditResultDialog(true)}>
            <Pencil size={16} className="mr-2" /> Edit who played
          </Button>
        )}

        {firstTimeAlert && (
          <Card className="border-orange-300 bg-orange-50">
            <CardContent className="p-4">
              <h4 className="font-semibold text-orange-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} /> First Time on This Ground
              </h4>
              <p className="text-sm text-orange-700 mb-3">{firstTimeAlert}</p>
              <div className="flex gap-2">
                <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => setFirstTimeAlert(null)}>
                  <CreditCard size={14} className="mr-1" /> Understood, I will pay
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {lateQuitWarning && (
          <Card className={lateQuitWarning === 'wl' ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'} data-testid="late-quit-warning">
            <CardContent className="p-4">
              <h4 className={`font-semibold mb-2 flex items-center gap-2 ${lateQuitWarning === 'wl' ? 'text-amber-800' : 'text-red-800'}`}>
                <AlertTriangle size={16} /> {lateQuitWarning === 'wl' ? 'Quitting late' : "You can't quit now"}
              </h4>
              {lateQuitWarning === 'wl' ? (
                <>
                  <p className="text-sm text-amber-800 mb-3">
                    You are quitting at short notice (less than {game.late_quit_hours} hours before the game).
                    Please tell <strong>{game.waiting_list[0] ? formatPlayerDisplay(game.waiting_list[0].name, game.waiting_list[0].phone, undefined, game.waiting_list[0].display_name) : 'the first player on the waiting list'}</strong> from
                    the waiting list that he is now playing in your place.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setLateQuitWarning('')}>Cancel</Button>
                    <Button size="sm" className="bg-red-600 hover:bg-red-700" data-testid="late-quit-anyway"
                      onClick={() => { setLateQuitWarning(''); confirmQuit(); }}>Quit anyway</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-red-700 mb-3">
                    It's short notice (less than {game.late_quit_hours} hours before the game) and no one is on the
                    waiting list to take your place, so you can't quit and you still pay for this game.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setLateQuitWarning('')}>OK</Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {showQuitConfirm && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="p-4">
              <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} /> Quit Confirmation
              </h4>
              {quitPenaltyInfo?.must_pay ? (
                <div>
                  <p className="text-sm text-red-700 mb-2">
                    The game starts in <strong>{quitPenaltyInfo.hours_until_game?.toFixed(1)} hours</strong>.
                    The quit penalty window is <strong>{quitPenaltyInfo.quit_penalty_hours} hours</strong> before the game.
                  </p>
                  <p className="text-sm text-red-700 font-semibold mb-3">
                    You will still need to pay {formatMoney(game.cost_per_person, currency)} even if you quit now.
                  </p>
                </div>
              ) : null}
              <p className="text-sm text-red-700 font-medium mb-3" data-testid="quit-warning">
                Are you sure you want to Quit? once done, you go in the queue last if you want to rejoin.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowQuitConfirm(false)}>Cancel</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={confirmQuit}>
                  {quitPenaltyInfo?.must_pay ? 'Quit (Must Pay)' : 'Confirm Quit'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 space-y-1.5">
            {game.pitch_format && (
              <div className="flex items-center gap-2 text-gray-600"><MapPin size={16} /> <span>{pitchLabel(game.pitch_format, game.pitch_number)}</span></div>
            )}
            {(isModerator || isAdmin) && game.status !== 'completed' && game.status !== 'cancelled' && !game.is_archived && new Date(`${game.game_date}T${game.game_time || '23:59'}`) > new Date() && (
              <div className={`text-xs rounded px-2 py-1 ${game.ground_confirmed ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
                {game.ground_confirmed
                  ? `Ground confirmed by Ground Manager${game.moderator_group_name ? ` · ${game.moderator_group_name}` : ''}`
                  : 'No confirmation from the Ground Manager for this ground and time yet'}
              </div>
            )}
            <div className="flex items-center gap-2 text-gray-600"><Clock size={16} /> <span>{formatGameDate(game.game_date)} at {formatTime12h(game.game_time)}</span></div>
            {game.duration_minutes > 0 && (
              <div className="flex items-center gap-2 text-gray-600"><Clock size={16} /> <span>Duration: {game.duration_minutes} minutes</span></div>
            )}
            <div className="flex items-center gap-2 text-gray-600"><Users size={16} /> <span>Max {game.max_players} players</span></div>
            <div className="flex items-center gap-2 text-gray-600">
              <CurrencyIcon currency={currency} size={16} />
              <span>
                {(isModerator || isAdmin || isGroundManagement) ? `Ground fee ${formatMoney((game.base_ground_cost || game.ground_cost).toFixed(0), currency)} / ` : 'Fee '}{formatMoney(perPerson.toFixed(0), currency)} per person ({game.payment_timing === 'before' ? 'PrePaid' : 'PostPaid'})
              </span>
              {game.fee_breakdown && (
                <button type="button" aria-label="Show cost breakdown" onClick={() => setShowCostBreakdown(v => !v)} className="text-gray-500">
                  <Info size={14} />
                </button>
              )}
            </div>
            {game.fee_breakdown && showCostBreakdown && (
              <div className="ml-6"><FeeBreakdownTable breakdown={game.fee_breakdown} fees={gameFees} currency={currency} /></div>
            )}
            {game.quit_penalty_hours > 0 && game.show_quit_penalty && (
              <div className="flex items-center gap-2 text-orange-600">
                <AlertTriangle size={16} /> <span>Quit penalty: Must pay if quitting within {game.quit_penalty_hours}h of game</span>
              </div>
            )}
            {game.receiver ? (
              <div className="flex items-center gap-2 text-gray-600"><Wallet size={16} /><PayTo receiver={game.receiver} /></div>
            ) : game.payee && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone size={16} />
                <span>Payment Receiver: {game.payee.name} ({formatPhone(game.payee.phone)})</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(game.payee!.phone)}
                  className="text-gray-400 hover:text-green-600"
                  title="Copy phone number"
                >
                  <Copy size={14} />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2">
          {isAdmin && game.status === 'draft' && !gameIsOver && !game.is_archived && (
            <Button className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => handleAction('open-voting', () => api.openVoting(game.id))}
              disabled={actionLoading === 'open-voting'}>
              {actionLoading === 'open-voting' ? 'Opening...' : 'Open for Nomination'}
            </Button>
          )}

          {isReadOnly && game.status === 'voting_open' && (
            <Card className="border-gray-200 bg-gray-50">
              <CardContent className="p-3 text-center text-sm text-gray-500">
                You are in Read-Only mode. Switch to User role to nominate or vote.
              </CardContent>
            </Card>
          )}

          {/* Edit Game - for Admin/Moderator on non-completed games */}
          {canEditGame && showEditGame && (
            <Card id="edit-game">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1"><Pencil size={14} /> Edit Game Settings</h4>
                  <Button size="sm" variant="outline" onClick={() => setShowEditGame(false)}>
                    Cancel
                  </Button>
                </div>
                {showEditGame && (
                  <div className="space-y-3">
                    <ReceiverSelect groundName={game.ground_name} value={editReceiverId} onChange={setEditReceiverId} />
                    <div>
                      <Label className="text-xs text-gray-500">Ground Cost ({currency})</Label>
                      <Input type="number" min="0" step="0.01" value={editGroundCost}
                        onChange={e => setEditGroundCost(e.target.value)} />
                      {(() => {
                        const total = parseFloat(editGroundCost) || 0;
                        const played = game.selected_players.filter(p => p.played).length;
                        const players = (game.status === 'completed' && played) || game.max_players || 1;
                        if (total <= 0 || players <= 0) return null;
                        return (
                          <>
                            <p className="text-xs text-green-600 mt-1">Cost per person: {formatMoney(Math.ceil(total / players - 0.001), currency)}{game.status === 'completed' ? ` (${players} played)` : ''}</p>
                            {game.status === 'completed' && (
                              <p className="text-xs text-gray-500 mt-1">Players who already paid will see any excess or remaining amount next to their name.</p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {game.status !== 'completed' && (
                    <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-gray-500">Quit Penalty (hours before game)</Label>
                        <Input type="number" min="0" max="72" value={editQuitPenalty}
                          onChange={e => setEditQuitPenalty(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">When to pay</Label>
                        <Select value={editPaymentMode} onValueChange={setEditPaymentMode}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="postpaid">After the game</SelectItem>
                            <SelectItem value="prepaid">Before the game</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500">How to pay</Label>
                      <PaymentCollectionChoice value={editPaymentCollection} onChange={setEditPaymentCollection} />
                    </div>
                    {game.note_before_players && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Note before player list</Label>
                      <Textarea value={editNoteBefore} onChange={e => setEditNoteBefore(e.target.value)} rows={2} className="text-sm" />
                    </div>
                    )}
                    {game.note_after_players && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Note after player list</Label>
                      <Textarea value={editNoteAfter} onChange={e => setEditNoteAfter(e.target.value)} rows={2} className="text-sm" />
                    </div>
                    )}
                    </>
                    )}
                    <Button className="w-full bg-blue-600 hover:bg-blue-700"
                      disabled={actionLoading === 'edit-game'}
                      onClick={() => {
                        handleAction('edit-game', () => api.editGame(game.id, game.status === 'completed' ? {
                          payee_user_id: editPayeeUserId ? Number(editPayeeUserId) : undefined,
                          receiver_id: Number(editReceiverId) || 0,
                          ground_cost: editGroundCost !== '' ? parseFloat(editGroundCost) : undefined,
                        } : {
                          payee_user_id: editPayeeUserId ? Number(editPayeeUserId) : undefined,
                          receiver_id: Number(editReceiverId) || 0,
                          quit_penalty_hours: parseInt(editQuitPenalty) || 0,
                          payment_mode: editPaymentMode,
                          payment_collection: editPaymentCollection,
                          ground_cost: editGroundCost !== '' ? parseFloat(editGroundCost) : undefined,
                          note_before_players: editNoteBefore,
                          note_after_players: editNoteAfter,
                        }));
                        setShowEditGame(false);
                      }}>
                      {actionLoading === 'edit-game' ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Cancel Game - for Moderator/Admin on active games that aren't over yet */}
          {(isModerator || isAdmin) && (game.status === 'voting_open' || game.status === 'in_progress' || game.status === 'draft') && !gameIsOver && !game.is_archived && (
            <>
              <Button variant="outline" className="w-full border-red-400 text-red-600 hover:bg-red-50"
                disabled={actionLoading === 'cancel-preview' || actionLoading === 'cancel'}
                onClick={async () => {
                  setActionLoading('cancel-preview');
                  try {
                    const preview = await api.cancelGamePreview(game.id);
                    setCancelPreview(preview);
                    setShowCancelPreview(true);
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : 'Failed to load cancel preview');
                  } finally {
                    setActionLoading('');
                  }
                }}>
                <XCircle size={16} className="mr-2" />
                {actionLoading === 'cancel-preview' ? 'Loading...' : 'Cancel Game'}
              </Button>

              {showCancelPreview && cancelPreview && (
                <Card className="border-red-300 bg-red-50">
                  <CardContent className="p-4 space-y-3">
                    <h4 className="font-semibold text-red-800 flex items-center gap-2">
                      <AlertTriangle size={16} /> Cancel Game Confirmation
                    </h4>
                    <p className="text-sm font-semibold text-red-800" data-testid="cancel-time-left">{timeToStart(game.game_date, game.game_time)}</p>
                    <div className="text-sm text-red-700 space-y-1">
                      <p><strong>Game:</strong> {cancelPreview.title}</p>
                      <p><strong>Ground:</strong> {cancelPreview.ground_name}</p>
                      <p><strong>Date/Time:</strong> {cancelPreview.game_date} at {cancelPreview.game_time}</p>
                      <Separator className="my-2" />
                      <p><strong>Confirmed Players:</strong> {cancelPreview.confirmed_players} of {cancelPreview.total_players} total</p>
                      <p><strong>Players who Paid:</strong> {cancelPreview.paid_players}</p>
                      {(cancelPreview.unverified_paid?.length ?? 0) > 0 ? (
                        <p className="text-amber-800 bg-amber-50 border border-amber-300 rounded p-2 font-medium" data-testid="cancel-unverified">
                          Some players have already paid ({cancelPreview.unverified_paid!.join(', ')}). Ask the Payment
                          Receiver{cancelPreview.receiver_name ? ` (${cancelPreview.receiver_name})` : ''} to verify these
                          payments first, then cancel the game.
                        </p>
                      ) : cancelPreview.refund_amount > 0 && (
                        <p className="text-red-800 font-semibold" data-testid="cancel-refund">
                          Refund {formatMoney(cancelPreview.refund_amount, currency)}: offline settlement to be done by the Payment
                          Receiver{cancelPreview.receiver_name ? ` (${cancelPreview.receiver_name})` : ''}. Game cost becomes 0 and nobody owes anything.
                        </p>
                      )}
                      <Separator className="my-2" />
                      <p className="text-xs text-red-600">
                        All players will receive a cancellation notification with game details.
                        {cancelPreview.paid_players > 0 && ' Paid players will be notified about their refund.'}
                        {' '}Users subscribed to this sport will also be notified.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1"
                        onClick={() => { setShowCancelPreview(false); setCancelPreview(null); }}>
                        Go Back
                      </Button>
                      <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                        disabled={actionLoading === 'cancel' || (cancelPreview.unverified_paid?.length ?? 0) > 0}
                        data-testid="confirm-cancel"
                        onClick={() => {
                          const refunds = cancelPreview.refund_amount > 0;
                          handleAction('cancel', async () => {
                            await api.cancelGame(game.id);
                            if (refunds) window.alert('Game cancelled. Offline settlement to be done by the Payment Receiver.');
                          });
                          setShowCancelPreview(false);
                          setCancelPreview(null);
                        }}>
                        {actionLoading === 'cancel' ? 'Cancelling...' : 'Confirm Cancel'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Delete Game - archived games: Admin only; otherwise Admin/Moderator/Ground Management on upcoming draft or cancelled games */}
          {canDeleteGame && (
            <>
              {showDeleteConfirm && (
                <Card id="delete-game" className="border-red-300 bg-red-50">
                  <CardContent className="p-4 space-y-3">
                    <h4 className="font-semibold text-red-800 flex items-center gap-2">
                      <Trash2 size={16} /> Delete Game Permanently
                    </h4>
                    <p className="text-sm text-red-700">
                      This will permanently remove the game and all nominations, votes, teams, payments, and messages associated with it.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1"
                        onClick={() => setShowDeleteConfirm(false)}>
                        Cancel
                      </Button>
                      <Button className="flex-1 bg-red-700 hover:bg-red-800 text-white"
                        disabled={actionLoading === 'delete'}
                        onClick={handleDelete}>
                        {actionLoading === 'delete' ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {(isModerator || isAdmin) && game.status === 'in_progress' && (
            <>
              <Button className="w-full bg-purple-600 hover:bg-purple-700"
                onClick={() => setShowCompleteDialog(true)}
                disabled={actionLoading === 'complete'}>
                {actionLoading === 'complete' ? 'Completing...' : 'Mark Game as Completed'}
              </Button>

              {/* Soccer Score Dialog */}
              {showScoreDialog && game.sport_type === 'soccer' && (
                <Card className="border-purple-200 bg-purple-50 mt-3">
                  <CardContent className="p-4">
                    {scoreStep === 'scores' ? (
                      <>
                        <h4 className="font-semibold text-purple-800 mb-3 flex items-center gap-2">
                          <Trophy size={16} /> Enter Final Score
                        </h4>
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Label className="w-24 text-sm font-medium">{game.teams[0]?.team_name || 'Team A'}</Label>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                                onClick={() => setTeamAScore(Math.max(0, teamAScore - 1))}>-</Button>
                              <span className="w-8 text-center font-bold text-lg">{teamAScore}</span>
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                                onClick={() => setTeamAScore(teamAScore + 1)}>+</Button>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Label className="w-24 text-sm font-medium">{game.teams[1]?.team_name || 'Team B'}</Label>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                                onClick={() => setTeamBScore(Math.max(0, teamBScore - 1))}>-</Button>
                              <span className="w-8 text-center font-bold text-lg">{teamBScore}</span>
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                                onClick={() => setTeamBScore(teamBScore + 1)}>+</Button>
                            </div>
                          </div>
                          <p className="text-xs text-purple-600">Total goals: {teamAScore + teamBScore}</p>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button variant="outline" className="flex-1" onClick={() => setShowScoreDialog(false)}>Cancel</Button>
                          {teamAScore + teamBScore > 0 ? (
                            <Button className="flex-1 bg-purple-600 hover:bg-purple-700" onClick={() => {
                              setGoalScorers({});
                              setScoreStep('scorers');
                            }}>Next: Goal Scorers</Button>
                          ) : (
                            <Button className="flex-1 bg-purple-600 hover:bg-purple-700"
                              disabled={actionLoading === 'complete'}
                              onClick={() => {
                                handleAction('complete', () => api.completeGame(game.id, {
                                  played_user_ids: pendingPlayedUserIds ?? game.selected_players.map(p => p.user_id),
                                  team_a_score: teamAScore, team_b_score: teamBScore, goal_scorers: []
                                }));
                                setShowScoreDialog(false);
                              }}>
                              {actionLoading === 'complete' ? 'Completing...' : 'Complete Game (0-0)'}
                            </Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <h4 className="font-semibold text-purple-800 mb-1 flex items-center gap-2">
                          <Trophy size={16} /> Who Scored?
                        </h4>
                        <p className="text-xs text-purple-600 mb-3">
                          Total goals: {teamAScore + teamBScore} | Attributed: {Object.values(goalScorers).reduce((a, b) => a + b, 0)} of {teamAScore + teamBScore}
                          {Object.values(goalScorers).reduce((a, b) => a + b, 0) < teamAScore + teamBScore && 
                            ` (${teamAScore + teamBScore - Object.values(goalScorers).reduce((a, b) => a + b, 0)} unattributed — may include self-goals)`}
                        </p>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {playedParticipants.map(player => {
                            const currentGoals = goalScorers[player.user_id] || 0;
                            const totalAttributed = Object.values(goalScorers).reduce((a, b) => a + b, 0);
                            const totalGoals = teamAScore + teamBScore;
                            const canAdd = totalAttributed < totalGoals;
                            return (
                              <div key={player.user_id} className="flex items-center justify-between bg-white rounded p-2">
                                <span className="text-sm">{formatPlayerDisplay(player.name, player.phone, undefined, player.display_name)}</span>
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                                    disabled={currentGoals === 0}
                                    onClick={() => setGoalScorers(prev => ({
                                      ...prev, [player.user_id]: Math.max(0, (prev[player.user_id] || 0) - 1)
                                    }))}>-</Button>
                                  <span className="w-6 text-center font-semibold text-sm">{currentGoals}</span>
                                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                                    disabled={!canAdd}
                                    onClick={() => setGoalScorers(prev => ({
                                      ...prev, [player.user_id]: (prev[player.user_id] || 0) + 1
                                    }))}>+</Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button variant="outline" className="flex-1" onClick={() => setScoreStep('scores')}>Back</Button>
                          <Button className="flex-1 bg-purple-600 hover:bg-purple-700"
                            disabled={actionLoading === 'complete'}
                            onClick={() => {
                              const scorersList = Object.entries(goalScorers)
                                .filter(([, goals]) => goals > 0)
                                .map(([userId, goals]) => ({ user_id: Number(userId), goals }));
                              handleAction('complete', () => api.completeGame(game.id, {
                                played_user_ids: pendingPlayedUserIds ?? game.selected_players.map(p => p.user_id),
                                team_a_score: teamAScore, team_b_score: teamBScore, goal_scorers: scorersList
                              }));
                              setShowScoreDialog(false);
                            }}>
                            {actionLoading === 'complete' ? 'Completing...' : 'Complete Game'}
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              <CompleteGameDialog
                open={showCompleteDialog}
                onOpenChange={setShowCompleteDialog}
                onComplete={handlePlayersSelected}
                selectedPlayers={game.selected_players}
                waitingList={game.waiting_list}
                paidIds={paidIds}
                maxPlayers={game.max_players}
                groundCost={game.ground_cost}
                currency={currency}
                isSoccer={game.sport_type === 'soccer' && game.teams.length >= 2}
              />
            </>
          )}

          <EditCompletedGameDialog
            open={showEditResultDialog}
            onOpenChange={setShowEditResultDialog}
            onSave={handleEditResult}
            allPlayers={[...game.selected_players, ...game.waiting_list]}
            teams={game.teams}
            gameScore={game.game_score}
            goalScorers={game.goal_scorers}
            groundCost={game.ground_cost}
            currency={currency}
            paidIds={paidIds}
            rosterLockedDays={game.roster_locked ? (game.roster_edit_days ?? 3) : undefined}
            loading={actionLoading === 'edit-result'}
          />

          {/* Pay-first player: added to the list only once paid */}
          {myAwaiting && (
            <Card className="border-orange-200 bg-orange-50" data-testid="pay-first-card">
              <CardContent className="p-4">
                <h4 className="font-semibold text-orange-800 mb-1 flex items-center gap-2">
                  <CreditCard size={16} /> Pay to Confirm Your Spot
                </h4>
                <p className="text-xs text-orange-700 mb-1">Your name is added to the list once your payment is received.</p>
                <p className="text-sm text-orange-700 mb-2">Amount: <strong>{formatMoney(myAwaiting.due ?? perPerson, currency)}</strong></p>
                {game.receiver ? <p className="text-sm text-orange-700 mb-3"><PayTo receiver={game.receiver} /></p> : game.payee && (
                  <p className="text-sm text-orange-700 mb-3">
                    Pay to: <strong>{game.payee.name}</strong> - <a href={`tel:${game.payee.phone}`} className="underline">{formatPhone(game.payee.phone)}</a>
                  </p>
                )}
                {payOnlineAvailable ? (
                  <>
                    <div className="mb-2"><FeeBreakdownTable breakdown={myAwaitingFees} fees={gameFees} currency={currency} /></div>
                    <Button className="w-full bg-orange-600 hover:bg-orange-700" data-testid="pay-first-online"
                      onClick={() => setPayPreview(myAwaitingFees)}
                      disabled={actionLoading === 'pay'}>
                      <Wallet size={16} className="mr-1" />
                      {actionLoading === 'pay' ? 'Opening payment...' : `Pay ${formatMoney(myAwaitingFees.total.toFixed(0), currency)} online`}
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-orange-700">After paying, ask the moderator to mark your payment as received.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Dialog open={!!payPreview} onOpenChange={o => { if (!o) setPayPreview(null); }}>
            <DialogContent className="max-w-sm" data-testid="pay-preview">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Wallet size={16} /> Where your money goes</DialogTitle></DialogHeader>
              {payPreview && (
                <div className="space-y-2 text-sm">
                  {[
                    [`${game.payee?.name || 'Payment receiver'} (ground share)`, payPreview.base],
                    [`App Fee (${gameFees.commission_percent}%${payPreview.app_fee_gst > 0 ? ' + GST' : ''})`, payPreview.app_fee + payPreview.app_fee_gst],
                    [`Cashfree (gateway fee ${gameFees.fee_percent}%${gameFees.gst_percent > 0 ? ` + ${gameFees.gst_percent}% GST` : ''})`, payPreview.gateway_fee],
                  ].map(([label, amt]) => (
                    <div key={label as string} className="flex justify-between gap-2">
                      <span className="text-gray-700">{label}</span>
                      <span className="whitespace-nowrap">{formatMoney((amt as number).toFixed(2), currency)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 font-semibold border-t pt-2">
                    <span>You pay</span><span>{formatMoney(payPreview.total.toFixed(0), currency)}</span>
                  </div>
                  <p className="text-xs text-gray-500">Cashfree sends the ground share straight to {game.payee?.name || 'the receiver'}'s UPI.</p>
                  <Button className="w-full bg-orange-600 hover:bg-orange-700" data-testid="pay-continue"
                    onClick={() => { setPayPreview(null); payOnline(game.id); }}>
                    Continue to pay {formatMoney(payPreview.total.toFixed(0), currency)}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Payment for current user - PrePaid */}
          {isSelectedPlayer && myPlayerRecord && myPlayerRecord.payment_confirmed !== 1 && (game.payment_timing === 'before' || myPlayerRecord.must_prepay) && (game.status === 'voting_open' || game.status === 'in_progress') && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="p-4">
                <h4 className="font-semibold text-orange-800 mb-1 flex items-center gap-2">
                  <CreditCard size={16} /> Pay Before the Game
                </h4>
                {game.payment_timing !== 'before' && (
                  <p className="text-xs text-orange-700 mb-1">The moderator has asked you to pay before this game.</p>
                )}
                <p className="text-sm text-orange-700 mb-2">Amount: <strong>{formatMoney(game.cost_per_person, currency)}</strong></p>
                {game.receiver ? <p className="text-sm text-orange-700 mb-3"><PayTo receiver={game.receiver} /></p> : game.payee && (
                  <p className="text-sm text-orange-700 mb-3">
                    Pay to: <strong>{game.payee.name}</strong> - <a href={`tel:${game.payee.phone}`} className="underline">{formatPhone(game.payee.phone)}</a>
                  </p>
                )}
                {payOnlineAvailable ? (
                  <>
                    <div className="mb-2"><FeeBreakdownTable breakdown={myFeeBreakdown} fees={gameFees} currency={currency} /></div>
                    <Button className="w-full bg-orange-600 hover:bg-orange-700" data-testid="pay-online"
                      onClick={() => setPayPreview(myFeeBreakdown)}
                      disabled={actionLoading === 'pay'}>
                      <Wallet size={16} className="mr-1" />
                      {actionLoading === 'pay' ? 'Opening payment...' : `Pay ${formatMoney(myFeeBreakdown.total.toFixed(0), currency)} online`}
                    </Button>
                  </>
                ) : (
                  <Button className="w-full bg-orange-600 hover:bg-orange-700"
                    onClick={() => setProofGameOpen(true)}
                    disabled={actionLoading === 'pay'}>
                    {actionLoading === 'pay' ? 'Recording...' : 'Mark as Paid'}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <MarkPaidDialog gameId={proofGameOpen ? game.id : null}
          amount={formatMoney(myPaidSoFar > 0 ? dueAmount(myPendingAmount) : perPerson.toFixed(0), currency)}
          payee={game.payee?.name} onClose={() => setProofGameOpen(false)}
          onDone={() => handleAction('pay', async () => {})} />
        <ProofViewer url={proofUrl} onClose={() => { URL.revokeObjectURL(proofUrl); setProofUrl(''); }} />

        {canCreateTeams && game.teams.length === 0 && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-blue-800 flex items-center gap-2">
                  <Users size={16} /> {game.selected_players.length}/{game.max_players} confirmed
                </p>
                {!showTeamForm && (
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700" data-testid="open-team-form"
                    onClick={() => setShowTeamForm(true)}>Create Teams</Button>
                )}
              </div>
              {showTeamForm && (<div className="mt-3">
              <div className="space-y-2 mb-3">
                <Label className="text-xs">Number of teams</Label>
                <Select value={teamCount} onValueChange={handleTeamCountChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 Teams</SelectItem>
                    <SelectItem value="3">3 Teams</SelectItem>
                    <SelectItem value="4">4 Teams</SelectItem>
                  </SelectContent>
                </Select>
                <Label className="text-xs">Team names and jersey colours</Label>
                {teamNames.slice(0, parseInt(teamCount)).map((name, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={name} className="min-w-0"
                      onChange={e => {
                        const updated = [...teamNames];
                        updated[i] = e.target.value;
                        setTeamNames(updated);
                      }}
                      placeholder={`Team ${i + 1} name`} />
                    <JerseyPicker value={teamColors[i] || ''} testId={`jersey-new-${i}`}
                      taken={teamColors.slice(0, parseInt(teamCount)).filter((_, j) => j !== i)}
                      onChange={v => setTeamColors(c => c.map((x, j) => (j === i ? v : x)))} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowTeamForm(false)}>Cancel</Button>
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700" data-testid="create-teams-submit"
                  onClick={handleCreateTeams} disabled={actionLoading === 'create-teams'}>
                  {actionLoading === 'create-teams' ? 'Creating...' : 'Create Teams'}
                </Button>
              </div>
              </div>)}
            </CardContent>
          </Card>
        )}

        {game.teams.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Users size={16} /> Teams</CardTitle>
                {(isAdmin || isModerator) && (
                  <Button size="sm" variant="outline" className="text-red-500 border-red-300"
                    onClick={handleDeleteTeams} disabled={actionLoading === 'delete-teams'}>
                    Remove Teams
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {(isAdmin || isModerator) && (
                <p className="text-xs text-gray-500">Drag players between teams to reassign them</p>
              )}
              {game.teams.map(team => (
                <div key={team.id}
                  className="bg-gray-50 rounded-lg p-3 border-2 border-dashed border-gray-200"
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(team.id)}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h5 className="font-semibold text-sm flex items-center gap-2">
                      <JerseySwatch color={team.jersey_color} /> {team.team_name}
                      {team.jersey_color && !(isAdmin || isModerator) && <span className="text-xs font-normal text-gray-500">({team.jersey_color})</span>}
                    </h5>
                    {(isAdmin || isModerator) && (
                      <JerseyPicker value={team.jersey_color || ''} testId={`jersey-${team.id}`}
                        taken={game.teams.filter(t => t.id !== team.id).map(t => t.jersey_color || '').filter(Boolean)}
                        onChange={v => handleAction(`jersey-${team.id}`, () => api.setTeamJersey(game.id, team.id, v))} />
                    )}
                  </div>
                  <div className="space-y-1">
                    {getTeamPlayers(team.id).map(player => (
                      <div key={player.id}
                        draggable={(isAdmin || isModerator) ? true : false}
                        onDragStart={() => handleDragStart(player)}
                        className={`flex items-center gap-2 text-sm p-1.5 bg-white rounded ${(isAdmin || isModerator) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        {(isAdmin || isModerator) && <GripVertical size={12} className="text-gray-400" />}
                        <span className="flex-1">{formatPlayerDisplay(player.name, player.phone, undefined, player.display_name)}</span>
                        {player.payment_confirmed === 1 && <CheckCircle size={14} className="text-green-600" />}
                      </div>
                    ))}
                    {getTeamPlayers(team.id).length === 0 && (
                      <p className="text-xs text-gray-400 py-2 text-center">Drop players here</p>
                    )}
                  </div>
                </div>
              ))}

              {getUnassignedPlayers().length > 0 && (
                <div className="bg-yellow-50 rounded-lg p-3 border-2 border-dashed border-yellow-200"
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(null)}>
                  <h5 className="font-semibold text-sm mb-2 text-yellow-700">Unassigned</h5>
                  <div className="space-y-1">
                    {getUnassignedPlayers().map(player => (
                      <div key={player.id}
                        draggable={(isAdmin || isModerator) ? true : false}
                        onDragStart={() => handleDragStart(player)}
                        className={`flex items-center gap-2 text-sm p-1.5 bg-white rounded ${(isAdmin || isModerator) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        {(isAdmin || isModerator) && <GripVertical size={12} className="text-gray-400" />}
                        <span className="flex-1">{formatPlayerDisplay(player.name, player.phone, undefined, player.display_name)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment Tracking */}
        {game.status === 'completed' && (game.payment_summary.total > 0 || (game.payment_details && game.payment_details.length > 0)) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><CurrencyIcon currency={currency} size={16} /> Payment Tracking</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-gray-800">{formatMoney(totalOutstanding.toFixed(0), currency)}</p>
                  <p className="text-xs text-gray-500">Total Outstanding</p>
                </div>
                <div className="bg-green-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-green-600">{formatMoney(totalReceived.toFixed(0), currency)}</p>
                  <p className="text-xs text-gray-500">Received</p>
                </div>
                <div className="bg-red-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-red-600">{formatMoney(pendingAmount.toFixed(0), currency)}</p>
                  <p className="text-xs text-gray-500">Pending</p>
                </div>
              </div>
              {(excessAmount > 0 || game.payment_collection === 'app') && (
                <p className="text-xs text-gray-600 -mt-2 mb-3 text-center" data-testid="payment-tracking-note">
                  {excessAmount > 0 && <span className="text-amber-600 font-medium">Excess to return: {formatMoney(excessAmount, currency)}. </span>}
                  {game.payment_collection === 'app' && 'Amounts are ground shares; app and gateway fees are extra for online payers.'}
                </p>
              )}
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div><p className="text-2xl font-bold text-gray-800">{game.payment_summary.total}</p><p className="text-xs text-gray-500">Total Players</p></div>
                <div><p className="text-2xl font-bold text-green-600">{game.payment_summary.paid}</p><p className="text-xs text-gray-500">Paid</p></div>
                <div><p className={`text-2xl font-bold ${game.payment_summary.pending > 0 ? 'text-red-600' : 'text-gray-400'}`}>{game.payment_summary.pending}</p><p className="text-xs text-gray-500">Pending</p></div>
              </div>

              {unpaidPlayers.length > 0 && (isModerator || isAdmin || game.is_receiver) && (
                <div>
                  <Button className="w-full bg-green-600 hover:bg-green-700" data-testid="open-remind" onClick={() => setShowRemind(true)}>
                    <MessageCircle size={16} className="mr-2" /> Remind Unpaid via WhatsApp
                  </Button>
                  <Dialog open={showRemind} onOpenChange={setShowRemind}>
                    <DialogContent className="max-w-sm" data-testid="remind-dialog">
                      <DialogHeader><DialogTitle className="flex items-center gap-2"><Bell size={16} /> Payment Reminder</DialogTitle></DialogHeader>
                      <div className="bg-white rounded-lg p-3 text-sm font-mono whitespace-pre-wrap mb-3 border max-h-[50vh] overflow-y-auto">
                        {generateRemindMsg()}
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1 bg-green-600 hover:bg-green-700"
                          onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(generateRemindMsg())}`, '_blank')}>
                          <MessageCircle size={16} className="mr-2" /> Share on WhatsApp
                        </Button>
                        <Button variant="outline" onClick={() => navigator.clipboard.writeText(generateRemindMsg())}>Copy</Button>
                      </div>
                      <Button variant="outline" className="w-full mt-2 border-green-300 text-green-700"
                        onClick={() => handleAction('remind', () => api.remindUnpaid(game.id))}
                        disabled={actionLoading === 'remind'}>
                        <Bell size={16} className="mr-2" />
                        {actionLoading === 'remind' ? 'Sending...' : 'Send In-App Reminder to Unpaid'}
                      </Button>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
        )}

          <Card className="relative !mt-10 rounded-tl-none">
            <CardHeader className="pb-2">
              <div className="absolute bottom-full -left-px flex gap-1" role="tablist">
                {(['current', 'log'] as const).map(t => (
                  <button key={t} type="button" role="tab" aria-selected={playersTab === t} data-testid={`players-tab-${t}`}
                    onClick={() => setPlayersTab(t)}
                    className={`-mb-px px-4 py-1 rounded-t-lg text-xs border ${playersTab === t
                      ? 'relative z-10 bg-white text-green-700 font-semibold border-gray-200 border-t-2 border-t-green-600 border-b-white'
                      : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    {t === 'current' ? 'Current' : 'Log'}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users size={16} /> {playersTab === 'log' ? 'Game Log' : `Confirmed Players (${game.selected_players.length}/${game.max_players})`}
                </CardTitle>
                {game.status === 'completed' && playersTab === 'current' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={showPaymentDetails} onCheckedChange={(v) => setShowPaymentDetails(!!v)} />
                    <span className="text-xs text-gray-600">Payment Details</span>
                  </label>
                )}
              </div>
            </CardHeader>
            {playersTab === 'log' ? (
              <CardContent className="p-4 pt-0"><GameLog gameId={game.id} /></CardContent>
            ) : (
            <CardContent className="p-4 pt-0 space-y-3">
              {game.note_before_players && (
                <div className="text-sm text-gray-700 bg-yellow-50 p-2 rounded border border-yellow-100 whitespace-pre-wrap">
                  {game.note_before_players}
                </div>
              )}
              {(isAdmin || isModerator || isGroundManagement) && game.status === 'completed' && game.roster_locked && (
                <p className="text-xs text-gray-500" data-testid="roster-locked">
                  Players can't be added or removed {game.roster_edit_days ?? 3} days after the game.
                </p>
              )}
              {(isAdmin || isModerator || isGroundManagement) && game.status !== 'cancelled' && !(game.status === 'completed' && game.roster_locked) && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500 flex items-center gap-1"><Search size={12} /> {game.status === 'completed' ? 'Add a player who played (cost is re-split)' : 'Add player by name or phone'}</Label>
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
                    <Input
                      placeholder="Type first few characters..."
                      value={addPlayerSearch}
                      onChange={(e) => setAddPlayerSearch(e.target.value)}
                      className="pl-8 text-sm"
                    />
                  </div>
                  {addPlayerSearch.trim() && (
                    <div className="border rounded-md divide-y max-h-36 overflow-y-auto">
                      {availableForNomination
                        .filter(u => {
                          const q = addPlayerSearch.toLowerCase();
                          return u.name.toLowerCase().includes(q) || u.phone.includes(q);
                        })
                        .slice(0, 6)
                        .map(u => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={addingPlayerId === u.id}
                            onClick={async () => {
                              if (game.status === 'completed') {
                                const n = game.selected_players.length;
                                if (!window.confirm(`Add ${u.name}? ${shareChangeText(game.ground_cost, n, n + 1, currency)} Continue?`)) return;
                              }
                              setAddingPlayerId(u.id);
                              try {
                                await api.nominatePlayer(game.id, u.id);
                                await loadGame();
                                setAddPlayerSearch('');
                              } catch (err: unknown) {
                                setError(err instanceof Error ? err.message : 'Failed to add player');
                              } finally {
                                setAddingPlayerId(null);
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex items-center justify-between"
                          >
                            <span>{formatPlayerDisplay(u.name, u.phone)}</span>
                            <Plus size={14} className="text-green-600" />
                          </button>
                        ))}
                      {availableForNomination.filter(u => {
                        const q = addPlayerSearch.toLowerCase();
                        return u.name.toLowerCase().includes(q) || u.phone.includes(q);
                      }).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">No matching players</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {game.selected_players.length === 0 ? (
                <p className="text-sm text-gray-400">No players yet</p>
              ) : (
                <div className="space-y-2">
                  {game.selected_players.map((player) => {
                    const playerVotes = potdResults.find(r => r.player_id === player.user_id);
                    return (
                    <div key={player.id}>
                      <div className="flex items-center gap-2 text-sm">
                        <button type="button" data-profile-trigger data-testid="player-avatar" aria-label={`View ${player.name}`} onClick={() => openProfile(player.user_id)}>
                      <PlayerAvatar photo={player.photo} gender={player.gender} alt={player.name} />
                    </button>
                        <span className="flex-1">
                          {formatPlayerDisplay(player.name, player.phone, undefined, player.display_name)}{player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
                          {player.tentative && game.status !== 'completed' && <TentativeBadge />}
                          {player.user_id === user?.id && <Badge className="ml-1 bg-green-100 text-green-700 text-xs">You</Badge>}
                          {player.user_id === user?.id && game.status === 'completed' && player.payment_confirmed !== 1 && !(game.pay_first_enabled && player.must_prepay) && (
                            <Button size="sm" className="ml-1 h-5 px-2 text-[11px] bg-orange-600 hover:bg-orange-700" data-testid="row-pay"
                              onClick={() => (payOnlineAvailable ? payOnline(game.id) : setProofGameOpen(true))}>
                              {payOnlineAvailable ? 'Pay' : 'Mark as paid'}
                            </Button>
                          )}
                          {game.pay_first_enabled && player.must_prepay && player.payment_confirmed !== 1 && (
                            <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 text-orange-700 border-orange-300">Pay first</Badge>
                          )}
                        </span>
                        {/* Profile info */}
                        <PlayerInfoButton player={player} />

                        {/* When Payment Details checkbox is NOT checked: show icons + POTD votes */}
                        {!showPaymentDetails && (
                          <>
                            <PaymentIcon
                              pd={paymentByUser.get(player.user_id)}
                              confirmed={player.payment_confirmed === 1}
                              due={game.status === 'completed' || game.payment_timing === 'before' || !!player.must_prepay}
                              currency={currency}
                              hasReceiver={!!game.receiver}
                              onReceived={(game.is_receiver || (isAdmin && !!game.receiver)) ? (ok) => {
                                if (ok || window.confirm(`Not received from ${player.name}? Their payment is cleared and they are asked to pay again.`)) {
                                  handleAction(ok ? 'received' : 'not-received', () => api.confirmReceived(game.id, player.user_id, ok));
                                }
                              } : undefined}
                              onViewProof={(isModerator || isAdmin || game.is_receiver || player.user_id === user?.id)
                                ? () => { api.getPaymentProof(game.id, player.user_id).then(setProofUrl).catch((e: Error) => setError(e.message)); }
                                : undefined}
                              onSettle={(isModerator || isAdmin) ? (amt) => {
                                if (window.confirm(`Returned ${formatMoney(amt, currency)} to this player offline? This marks the excess as settled.`)) {
                                  handleAction('settle', () => api.settleExcess(game.id, player.user_id));
                                }
                              } : undefined}
                            />
                            {game.status === 'completed' && playerVotes && playerVotes.points > 0 && (
                              <PotdPointsBadge result={playerVotes} />
                            )}
                          </>
                        )}

                        {/* When Payment Details checkbox IS checked: show Mark as Paid + Pay columns */}
                        {showPaymentDetails && player.payment_confirmed !== 1 && (isModerator || isAdmin) && player.user_id !== user?.id && (
                          <>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-green-600 border-green-300"
                              onClick={() => {
                                const now = new Date();
                                const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                                const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                setMarkPaidComment(`Payment Marked as Paid by ${user?.user_code || 'Moderator'} on ${dateStr} ${timeStr}`);
                                setMarkPaidPlayerId(player.user_id);
                              }}>
                              Mark as Paid
                            </Button>
                          </>
                        )}
                        {showPaymentDetails && player.payment_confirmed === 1 && (
                          <Badge className="bg-green-100 text-green-700 text-xs">Paid</Badge>
                        )}
                        {removableStage && <RemovePlayerButton allowed={canRemove(player)} paid={hasPaid(player.user_id)} onRemove={() => removePlayer(player)} />}


                        {/* Fallback: non-completed games still show old mark paid button */}
                        {!showPaymentDetails && (isModerator || isAdmin) && player.payment_confirmed !== 1 && (game.status === 'in_progress') && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-green-600 border-green-300"
                            onClick={() => handleAction(`mark-paid-${player.user_id}`, () => api.markPaymentMade(game.id, player.user_id))}
                            disabled={actionLoading === `mark-paid-${player.user_id}`}>
                            {actionLoading === `mark-paid-${player.user_id}` ? '...' : 'Mark Paid'}
                          </Button>
                        )}
                      </div>

                      {/* Mark as Paid comment dialog (inline) */}
                      {markPaidPlayerId === player.user_id && (
                        <div data-context-menu className="ml-8 mt-2 p-3 bg-green-50 rounded-lg border border-green-200 space-y-2">
                          <Label className="text-xs font-medium text-green-800">Reference / Comment</Label>
                          <Textarea
                            value={markPaidComment}
                            onChange={e => setMarkPaidComment(e.target.value)}
                            rows={2}
                            className="text-sm"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-xs"
                              disabled={actionLoading === `mark-paid-${player.user_id}`}
                              onClick={async () => {
                                setActionLoading(`mark-paid-${player.user_id}`);
                                try {
                                  await api.markPaidWithComment(game.id, player.user_id, markPaidComment);
                                  setMarkPaidPlayerId(null);
                                  setMarkPaidComment('');
                                  await loadGame();
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Failed');
                                } finally {
                                  setActionLoading('');
                                }
                              }}>
                              {actionLoading === `mark-paid-${player.user_id}` ? 'Saving...' : 'Confirm Payment'}
                            </Button>
                            <Button size="sm" variant="outline" className="text-xs"
                              onClick={() => { setMarkPaidPlayerId(null); setMarkPaidComment(''); }}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
              {game.note_after_players && (
                <div className="text-sm text-gray-700 bg-yellow-50 p-2 rounded border border-yellow-100 whitespace-pre-wrap mt-3">
                  {game.note_after_players}
                </div>
              )}
            </CardContent>
            )}
          </Card>

        {game.pay_first_enabled && (isModerator || isAdmin) && (game.awaiting_payment?.length ?? 0) > 0 && (
          <Card data-testid="awaiting-payment-list">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-600 flex items-center gap-2">
                <Wallet size={16} /> Awaiting Payment ({game.awaiting_payment!.length})
              </CardTitle>
              <p className="text-xs text-gray-500">Pay-first players. Their name is added to the list once they pay.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {game.awaiting_payment!.map(p => (
                <div key={p.user_id} className="flex items-center justify-between gap-2 text-sm">
                  <button type="button" className="text-left hover:underline truncate" onClick={() => openProfile(p.user_id)}>
                    {p.display_name || p.name}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">{formatMoney(p.due ?? 0, currency)} due</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => handleAction(`mark-paid-${p.user_id}`, () => api.markPaymentMade(game.id, p.user_id))}
                      disabled={actionLoading === `mark-paid-${p.user_id}`}>
                      Mark Paid
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {game.waiting_list.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-orange-600">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full text-left"
                  disabled={game.status !== 'completed'}
                  onClick={() => setWaitingOpen(o => !o)}
                  data-testid="waiting-list-toggle"
                >
                  <Clock size={16} /> Waiting List ({game.waiting_list.length})
                  {game.status === 'completed' && (
                    <span className="ml-auto text-xs font-normal text-gray-500">{waitingOpen ? 'Hide' : 'Show'}</span>
                  )}
                </button>
              </CardTitle>
            </CardHeader>
            {(game.status !== 'completed' || waitingOpen) && (
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {game.waiting_list.map((player) => (
                  <div key={player.id} className="flex items-center gap-2 text-sm">
                    <button type="button" data-profile-trigger data-testid="player-avatar" aria-label={`View ${player.name}`} onClick={() => openProfile(player.user_id)}>
                      <PlayerAvatar photo={player.photo} gender={player.gender} alt={player.name} />
                    </button>
                    <span className="flex-1">
                      {formatPlayerDisplay(player.name, player.phone, undefined, player.display_name)}{player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
                      {player.tentative && game.status !== 'completed' && <TentativeBadge />}
                      {player.user_id === user?.id && <Badge className="ml-1 bg-orange-100 text-orange-700 text-xs">You</Badge>}
                    </span>
                    <PlayerInfoButton player={player} />
                    {game.status === 'completed' && (isAdmin || isModerator || isGroundManagement) && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" data-testid="mark-played"
                        onClick={() => handleAction('nominate', () => api.nominatePlayer(game.id, player.user_id))}>
                        + Played
                      </Button>
                    )}
                    {removableStage && <RemovePlayerButton allowed={canRemove(player)} paid={hasPaid(player.user_id)} onRemove={() => removePlayer(player)} />}
                  </div>
                ))}
              </div>
            </CardContent>
            )}
          </Card>
        )}


        {game.status === 'completed' && isSelectedPlayer && !isReadOnly && potdVotingOpen && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-yellow-700">
                <Star size={16} /> Nominate Player of the Day
              </CardTitle>
              {potdDeadline && (
                <p className="text-xs text-yellow-600">Nominations close: {potdDeadline}</p>
              )}
              {potdMyVotes.length > 0 && (
                <p className="text-xs text-green-600 font-medium">You have already voted. You can update your votes below.</p>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {/* 1st Preference (Required) */}
              <div>
                <Label className="text-xs font-semibold text-yellow-800">1st Preference (3 pts) *</Label>
                <Select value={potdFirstPref} onValueChange={(v) => {
                  setPotdFirstPref(v);
                  if (v === potdSecondPref) setPotdSecondPref('');
                  if (v === potdThirdPref) setPotdThirdPref('');
                }}>
                  <SelectTrigger><SelectValue placeholder="Select best player" /></SelectTrigger>
                  <SelectContent>
                    {game.selected_players.filter(p => p.user_id !== user?.id).map(p => (
                      <SelectItem key={p.user_id} value={String(p.user_id)}>{formatPlayerDisplay(p.name, p.phone, undefined, p.display_name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* 2nd Preference (Optional) */}
              <div>
                <Label className="text-xs font-semibold text-yellow-700">2nd Preference (2 pts)</Label>
                <Select value={potdSecondPref} onValueChange={(v) => {
                  setPotdSecondPref(v);
                  if (v === potdThirdPref) setPotdThirdPref('');
                }}>
                  <SelectTrigger><SelectValue placeholder="Optional - 2nd best" /></SelectTrigger>
                  <SelectContent>
                    {game.selected_players
                      .filter(p => p.user_id !== user?.id && String(p.user_id) !== potdFirstPref)
                      .map(p => (
                        <SelectItem key={p.user_id} value={String(p.user_id)}>{formatPlayerDisplay(p.name, p.phone, undefined, p.display_name)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {/* 3rd Preference (Optional, requires 2nd) */}
              <div>
                <Label className="text-xs font-semibold text-yellow-700">3rd Preference (1 pt)</Label>
                <Select value={potdThirdPref} onValueChange={setPotdThirdPref} disabled={!potdSecondPref}>
                  <SelectTrigger><SelectValue placeholder={potdSecondPref ? 'Optional - 3rd best' : 'Select 2nd first'} /></SelectTrigger>
                  <SelectContent>
                    {game.selected_players
                      .filter(p => p.user_id !== user?.id && String(p.user_id) !== potdFirstPref && String(p.user_id) !== potdSecondPref)
                      .map(p => (
                        <SelectItem key={p.user_id} value={String(p.user_id)}>{formatPlayerDisplay(p.name, p.phone, undefined, p.display_name)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full bg-yellow-600 hover:bg-yellow-700"
                disabled={!potdFirstPref || actionLoading === 'potd'}
                onClick={() => handleAction('potd', () =>
                  api.voteRankedPOTD(
                    game.id,
                    Number(potdFirstPref),
                    potdSecondPref ? Number(potdSecondPref) : undefined,
                    potdThirdPref ? Number(potdThirdPref) : undefined
                  )
                )}>
                {actionLoading === 'potd' ? 'Submitting...' : (potdMyVotes.length > 0 ? 'Update Vote' : 'Submit Vote')}
              </Button>
            </CardContent>
          </Card>
        )}

        {game.status === 'completed' && potdResults.length > 0 && (
          <Card className="border-yellow-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Trophy size={16} className="text-yellow-500" /> Player of the Day Rankings</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {potdResults.map((r, idx) => {
                const p = [...game.selected_players, ...game.waiting_list].find(x => x.user_id === r.player_id);
                return (
                  <div key={r.player_id} className="flex items-center gap-2 mb-2 p-2 rounded" data-testid="potd-rank">
                    <span className="w-6 text-center text-lg leading-none">{['\u{1F947}', '\u{1F948}', '\u{1F949}'][idx] ?? <span className="text-xs text-gray-400">{idx + 1}</span>}</span>
                    <button type="button" onClick={() => setProfileUserId(r.player_id)} aria-label={`Open ${r.name}'s profile`} data-testid="potd-avatar">
                      <PlayerAvatar photo={p?.photo} gender={p?.gender} size="md" alt={r.name} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800">{r.name}</span>
                      <div className="text-xs text-gray-400">
                        {r.first_pref > 0 && <span className="mr-2">1st: {r.first_pref}</span>}
                        {r.second_pref > 0 && <span className="mr-2">2nd: {r.second_pref}</span>}
                        {r.third_pref > 0 && <span>3rd: {r.third_pref}</span>}
                      </div>
                    </div>
                    <Badge variant="outline">{r.points} {r.points === 1 ? 'pt' : 'pts'}</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {game.status !== 'completed' && game.status !== 'cancelled' && !game.is_archived && (
          <>
            <Button variant="outline" className="w-full" data-testid="open-invite" onClick={() => setShowInvite(true)}>
              <Users size={16} className="mr-2" /> Invite to this game (link / QR)
            </Button>
            {showInvite && <InviteDialog title="Invite to this game" url={inviteUrl(user?.id, game.id)}
              message={`Join "${game.title}" on ${game.game_date}${game.game_time ? ` at ${game.game_time}` : ''}. Tap to open the game and nominate yourself:`}
              onClose={() => setShowInvite(false)} />}
          </>
        )}

        {(isModerator || isAdmin) && (game.status === 'voting_open' || game.status === 'in_progress') && (
          <>
            <Button variant="outline" className="w-full border-green-300 text-green-700 bg-green-50" data-testid="open-status"
              onClick={() => setShowStatus(true)}>
              <Share2 size={16} className="mr-2" /> Send Current Status
            </Button>
            <Dialog open={showStatus} onOpenChange={setShowStatus}>
              <DialogContent className="max-w-sm" data-testid="status-dialog">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Share2 size={16} /> Send Current Status</DialogTitle></DialogHeader>

              <div className="bg-white rounded-lg p-3 text-sm font-mono whitespace-pre-wrap mb-3 border max-h-[50vh] overflow-y-auto">
                {generateStatusMsg()}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    const msg = generateStatusMsg();
                    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                  }}>
                  <MessageCircle size={16} className="mr-2" /> Share on WhatsApp
                </Button>
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(generateStatusMsg())}>Copy</Button>
              </div>
              <Button variant="outline" className="w-full mt-2 border-green-300 text-green-700"
                onClick={() => handleAction('broadcast', () => api.broadcastStatus(game.id))}
                disabled={actionLoading === 'broadcast'}>
                <Bell size={16} className="mr-2" />
                {actionLoading === 'broadcast' ? 'Sending...' : 'Send as In-App Notification'}
              </Button>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* Discussion Section - Always active */}
        <Discussion gameId={game.id} gameStatus={game.status}
          members={[...game.selected_players, ...game.waiting_list].map(p => ({ id: p.user_id, name: p.display_name || p.name }))} />

        <Separator />
        <p className="text-xs text-gray-400 text-center pb-4">Game ID: {game.id}</p>

        {/* Player Profile Modal */}
        {profileUserId && (
          <PlayerProfileDialog userId={profileUserId} sport={game.sport_type} gameId={game.id} onClose={() => setProfileUserId(null)} />
        )}
      </div>
    </div>
  );
}
