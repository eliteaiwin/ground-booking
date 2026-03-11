import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, DollarSign, Users, AlertTriangle, Search, CheckCircle, X } from 'lucide-react';

interface GamePayment {
  game_id: number;
  game_title: string;
  game_date: string;
  sport_type: string;
  ground_name: string;
  game_status: string;
  amount: number;
  status: string;
  paid_at: string | null;
}

interface UserPayment {
  user_id: number;
  name: string;
  phone: string;
  games: GamePayment[];
  total_pending: number;
  total_paid: number;
}

interface GameSummary {
  game_id: number;
  title: string;
  sport_type: string;
  game_date: string;
  ground_name: string;
  cost_per_person: number;
  game_status: string;
  total_players: number;
  paid_count: number;
  pending_count: number;
  total_collected: number;
  total_pending: number;
}

interface GameDropdown {
  id: number;
  title: string;
  game_date: string;
  sport_type: string;
  ground_name: string;
  status: string;
}

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return <span>&#9917;</span>;
  if (type === 'cricket') return <span>&#127951;</span>;
  if (type === 'badminton') return <span>&#127992;</span>;
  if (type === 'basketball') return <span>&#127936;</span>;
  if (type === 'hockey') return <span>&#127954;</span>;
  return <span>&#127941;</span>;
};

interface Props {
  onBack: () => void;
}

export default function AdminSummary({ onBack }: Props) {
  const [perGame, setPerGame] = useState<GameSummary[]>([]);
  const [usersWithPayments, setUsersWithPayments] = useState<UserPayment[]>([]);
  const [gamesDropdown, setGamesDropdown] = useState<GameDropdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaid, setShowPaid] = useState(true);
  const [showUnpaid, setShowUnpaid] = useState(true);
  const [gameStatus, setGameStatus] = useState('all');
  const [dateRange, setDateRange] = useState('today5');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [markPaidPopup, setMarkPaidPopup] = useState<{ userId: number; gameId: number; userName: string; gameTitle: string } | null>(null);
  const [markPaidComment, setMarkPaidComment] = useState('');
  const [markingPaid, setMarkingPaid] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let paymentStatusFilter: string | undefined;
      if (showPaid && !showUnpaid) paymentStatusFilter = 'paid';
      else if (!showPaid && showUnpaid) paymentStatusFilter = 'pending';
      else paymentStatusFilter = undefined;
      const data = await api.paymentSummary({
        payment_status: paymentStatusFilter,
        game_status: gameStatus === 'all' ? undefined : gameStatus,
        date_range: dateRange === 'all' ? undefined : dateRange,
        game_id: selectedGameId || undefined,
      });
      setPerGame(data.per_game || []);
      setUsersWithPayments(data.users_with_payments || []);
      setGamesDropdown(data.games_dropdown || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [showPaid, showUnpaid, gameStatus, dateRange, selectedGameId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalCollected = perGame.reduce((s, g) => s + g.total_collected, 0);
  const totalPendingAmount = perGame.reduce((s, g) => s + g.total_pending, 0);

  const filteredUsers = usersWithPayments.filter(u => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.phone.includes(q);
  });

  const handleMarkPaid = async () => {
    if (!markPaidPopup) return;
    setMarkingPaid(true);
    try {
      await api.markPaidWithComment(markPaidPopup.gameId, markPaidPopup.userId, markPaidComment);
      setMarkPaidPopup(null);
      setMarkPaidComment('');
      fetchData();
    } catch { alert('Failed to mark as paid'); } finally { setMarkingPaid(false); }
  };

  const gameStatusLabel = (s: string) => {
    if (s === 'voting_open') return 'Voting Open';
    if (s === 'in_progress') return 'In Progress';
    if (s === 'completed') return 'Completed';
    if (s === 'draft') return 'Draft';
    if (s === 'abandoned') return 'Abandoned';
    return s;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">Payment Summary</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Filters</p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} className="rounded border-gray-300" /> Paid
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showUnpaid} onChange={e => setShowUnpaid(e.target.checked)} className="rounded border-gray-300" /> Unpaid
              </label>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Game Status</label>
              <select value={gameStatus} onChange={e => { setGameStatus(e.target.value); setSelectedGameId(null); }} className="w-full border rounded-md p-2 text-sm">
                <option value="all">All</option>
                <option value="voting_open">Open for Voting</option>
                <option value="completed">Closed</option>
                <option value="abandoned">Abandon</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Date Range</label>
              <select value={dateRange} onChange={e => { setDateRange(e.target.value); setSelectedGameId(null); }} className="w-full border rounded-md p-2 text-sm">
                <option value="today5">Today +/- 5 days</option>
                <option value="month">Last One Month</option>
                <option value="year">Last One Year</option>
                <option value="all">All</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Select Game</label>
              <select value={selectedGameId || ''} onChange={e => setSelectedGameId(e.target.value ? Number(e.target.value) : null)} className="w-full border rounded-md p-2 text-sm">
                <option value="">All Games</option>
                {gamesDropdown.map(g => (<option key={g.id} value={g.id}>{g.game_date} {g.title}</option>))}
              </select>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : (
          <>
            {/* Overall Summary */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-4 text-center">
                  <DollarSign size={20} className="mx-auto text-green-600 mb-1" />
                  <p className="text-2xl font-bold text-green-700">${totalCollected.toFixed(2)}</p>
                  <p className="text-xs text-green-600">Total Collected</p>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4 text-center">
                  <AlertTriangle size={20} className="mx-auto text-red-600 mb-1" />
                  <p className="text-2xl font-bold text-red-700">${totalPendingAmount.toFixed(2)}</p>
                  <p className="text-xs text-red-600">Total Pending</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-Game Breakdown */}
            <Card>
              <CardHeader><CardTitle className="text-base">Per-Game Breakdown</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                {perGame.length === 0 ? (
                  <p className="text-sm text-gray-400">No games match the current filters</p>
                ) : (
                  perGame.map(g => (
                    <div key={g.game_id} className="border-b pb-3 last:border-b-0">
                      <div className="flex items-center gap-2 mb-1">
                        {sportIcon(g.sport_type)}
                        <span className="font-medium text-sm">{g.title}</span>
                        <Badge className="text-xs" variant="outline">{gameStatusLabel(g.game_status)}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{g.ground_name} - {g.game_date}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-600">{g.paid_count} paid</span>
                        <span className="text-red-600">{g.pending_count} pending</span>
                        <span className="text-gray-500">
                          ${g.total_collected.toFixed(2)} / ${(g.total_collected + g.total_pending).toFixed(2)}
                        </span>
                      </div>
                      {g.total_players > 0 && (
                        <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-green-500 rounded-full h-2 transition-all" style={{ width: `${(g.paid_count / g.total_players) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Users Section */}
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users size={16} /> Users</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Search user by name or phone..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-md text-sm" />
                </div>
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-2">No users match</p>
                ) : (
                  filteredUsers.map(u => (
                    <div key={u.user_id} className="border rounded-lg overflow-hidden">
                      <button onClick={() => setExpandedUserId(expandedUserId === u.user_id ? null : u.user_id)} className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50">
                        <div>
                          <p className="font-medium text-sm">{u.name}</p>
                          <p className="text-xs text-gray-500">{u.phone} - {u.games.length} game(s)</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {u.total_pending > 0 && <Badge className="bg-red-100 text-red-700">${u.total_pending.toFixed(2)}</Badge>}
                          {u.total_paid > 0 && <Badge className="bg-green-100 text-green-700">${u.total_paid.toFixed(2)}</Badge>}
                        </div>
                      </button>
                      {expandedUserId === u.user_id && (
                        <div className="border-t bg-gray-50 p-3 space-y-2">
                          {u.games.map((g, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs border-b pb-2 last:border-b-0">
                              <div className="flex-1">
                                <div className="flex items-center gap-1">{sportIcon(g.sport_type)}<span className="font-medium">{g.game_title}</span></div>
                                <p className="text-gray-500">{g.ground_name} - {g.game_date}</p>
                                <Badge variant="outline" className="text-xs mt-1">{gameStatusLabel(g.game_status)}</Badge>
                              </div>
                              <div className="text-right flex items-center gap-2">
                                <div>
                                  <p className="font-bold">${g.amount.toFixed(2)}</p>
                                  <Badge className={g.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{g.status === 'paid' ? 'Paid' : 'Unpaid'}</Badge>
                                </div>
                                {g.status === 'pending' && (
                                  <button onClick={(e) => { e.stopPropagation(); setMarkPaidPopup({ userId: u.user_id, gameId: g.game_id, userName: u.name, gameTitle: g.game_title }); }} className="bg-green-600 text-white text-xs px-2 py-1 rounded hover:bg-green-700 whitespace-nowrap">Mark as Paid</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Mark as Paid Popup */}
      {markPaidPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><CheckCircle size={20} className="text-green-600" /> Mark as Paid</h3>
              <button onClick={() => { setMarkPaidPopup(null); setMarkPaidComment(''); }}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="text-sm text-gray-600">
              <p><strong>User:</strong> {markPaidPopup.userName}</p>
              <p><strong>Game:</strong> {markPaidPopup.gameTitle}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Comment</label>
              <textarea value={markPaidComment} onChange={e => setMarkPaidComment(e.target.value)} placeholder="e.g. Paid to Sri on 22-Mar-26 on Gpay" className="w-full border rounded-md p-2 text-sm h-20 resize-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setMarkPaidPopup(null); setMarkPaidComment(''); }} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleMarkPaid} disabled={markingPaid} className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm hover:bg-green-700 disabled:opacity-50">{markingPaid ? 'Saving...' : 'Confirm Payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
