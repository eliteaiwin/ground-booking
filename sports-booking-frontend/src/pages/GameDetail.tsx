import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Trophy, Users, Clock, MapPin, DollarSign, Phone, Star, UserPlus, Share2, MessageCircle, Bell, AlertTriangle, CreditCard, GripVertical, CheckCircle, Archive, Info, Banknote, Pencil, XCircle } from 'lucide-react';

const SPORT_POSITIONS: Record<string, string[]> = {
  soccer: ['Anywhere', 'Goalkeeper', 'Right Back', 'Left Back', 'Center Back', 'Midfielder', 'Right Wing', 'Left Wing', 'Striker', 'Forward'],
  cricket: ['Anywhere', 'Batsman', 'Bowler', 'All-Rounder', 'Wicket Keeper'],
  badminton: ['Anywhere', 'Singles', 'Doubles'],
  basketball: ['Anywhere', 'Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center'],
  hockey: ['Anywhere', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
};

const sportIconSmall = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
};

interface Player {
  id: number;
  user_id: number;
  name: string;
  phone: string;
  status: string;
  position: string;
  team_id: number | null;
  payment_confirmed: number;
  nominated_by: number | null;
  nominated_by_info: string | null;
  joined_at: string;
}

interface Team {
  id: number;
  team_name: string;
  team_order: number;
}

interface PaymentDetail {
  user_id: number;
  name: string;
  status: string;
  amount: number;
  paid_at: string | null;
}

interface Game {
  id: number;
  title: string;
  sport_type: string;
  ground_name: string;
  game_date: string;
  game_time: string;
  max_players: number;
  cost_per_person: number;
  payment_timing: string;
  status: string;
  quit_penalty_hours: number;
  duration_minutes: number;
  is_archived: boolean;
  payee: { id: number; name: string; phone: string } | null;
  created_by: number;
  created_by_name: string;
  selected_players: Player[];
  waiting_list: Player[];
  teams: Team[];
  payment_summary: { total: number; paid: number; pending: number };
  payment_details: PaymentDetail[];
  player_of_the_day: { player_id: number; name: string; votes: number } | null;
}

interface UserItem {
  id: number;
  name: string;
  phone: string;
  roles: string[];
}

interface POTDResult {
  player_id: number;
  name: string;
  votes: number;
}

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return <span className="text-3xl">&#9917;</span>;
  if (type === 'cricket') return <span className="text-3xl">&#127951;</span>;
  if (type === 'badminton') return <span className="text-3xl">&#127992;</span>;
  if (type === 'basketball') return <span className="text-3xl">&#127936;</span>;
  if (type === 'hockey') return <span className="text-3xl">&#127954;</span>;
  return <span className="text-3xl">&#127941;</span>;
};

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

const statusLabel = (status: string, isArchived: boolean) => {
  if (isArchived) return 'Archived';
  switch (status) {
    case 'draft': return 'Draft';
    case 'voting_open': return 'Voting Open';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
};

interface Props {
  gameId: number;
  onBack: () => void;
}

export default function GameDetail({ gameId, onBack }: Props) {
  const { user, isAdmin, isModerator } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [nominateUserId, setNominateUserId] = useState('');
  const [nominatePosition, setNominatePosition] = useState('');
  const [potdPlayerId, setPotdPlayerId] = useState('');
  const [potdResults, setPotdResults] = useState<POTDResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [votePosition, setVotePosition] = useState('');
  const [showEditGame, setShowEditGame] = useState(false);
  const [editPayeeUserId, setEditPayeeUserId] = useState('');
  const [editQuitPenalty, setEditQuitPenalty] = useState('0');
  const [editPaymentMode, setEditPaymentMode] = useState('postpaid');
  const [editCostPerPerson, setEditCostPerPerson] = useState('');
  const [tooltipPlayerId, setTooltipPlayerId] = useState<number | null>(null);
  const [teamCount, setTeamCount] = useState('2');
  const [teamNames, setTeamNames] = useState<string[]>(['Team A', 'Team B']);
  const [dragPlayer, setDragPlayer] = useState<Player | null>(null);
  const [quitPenaltyInfo, setQuitPenaltyInfo] = useState<{has_penalty: boolean; must_pay: boolean; hours_until_game?: number; quit_penalty_hours?: number} | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [firstTimeAlert, setFirstTimeAlert] = useState<string | null>(null);
  const [showCancelPreview, setShowCancelPreview] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<{
    confirmed_players: number; total_players: number; paid_players: number; refund_amount: number;
    title: string; ground_name: string; game_date: string; game_time: string;
  } | null>(null);

  const currency = user?.currency || 'Rs';

  useEffect(() => {
    loadGame();
  }, [gameId]);

  const loadGame = async () => {
    try {
      const [gameData, usersData] = await Promise.all([
        api.getGame(gameId),
        api.listUsers(),
      ]);
      setGame(gameData);
      setAllUsers(usersData);
      if (gameData.status === 'completed') {
        try {
          const potd = await api.getPOTD(gameId);
          setPotdResults(potd.results || []);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isPlayerInGame = game?.selected_players.some(p => p.user_id === user?.id) ||
    game?.waiting_list.some(p => p.user_id === user?.id);
  const isSelectedPlayer = game?.selected_players.some(p => p.user_id === user?.id);
  const myPlayerRecord = game?.selected_players.find(p => p.user_id === user?.id);

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

  const handleQuitClick = async () => {
    if (game?.status === 'in_progress' && game?.quit_penalty_hours > 0) {
      try {
        const info = await api.checkQuitPenalty(game.id);
        setQuitPenaltyInfo(info);
        setShowQuitConfirm(true);
      } catch {
        setShowQuitConfirm(true);
      }
    } else {
      handleAction('quit', () => api.quitGame(game!.id));
    }
  };

  const confirmQuit = () => {
    setShowQuitConfirm(false);
    handleAction('quit', () => api.quitGame(game!.id));
  };

  const handleCreateTeams = async () => {
    const names = teamNames.slice(0, parseInt(teamCount));
    await handleAction('create-teams', () => api.createTeams(game!.id, names));
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
    msg += `Per Person Cost: ${game!.cost_per_person} ${currency}\n\n`;

    msg += `Confirmed:\n------------\n`;
    game!.selected_players.forEach((p, i) => {
      const paidMark = p.payment_confirmed === 1 ? ' \u2705' : '';
      msg += `${i + 1}. ${p.name}${p.position && p.position !== 'Anywhere' ? ` (${p.position})` : ''}${paidMark}\n`;
    });

    if (game!.waiting_list.length > 0) {
      msg += `\nWaiting List:\n-------------\n`;
      game!.waiting_list.forEach((p, i) => {
        msg += `${i + 1}. ${p.name}${p.position && p.position !== 'Anywhere' ? ` (${p.position})` : ''}\n`;
      });
    }

    return msg;
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

  const positions = SPORT_POSITIONS[game.sport_type] || [];

  const unpaidPlayers = (game.payment_details || []).filter(pd => pd.status === 'pending');
  const paidPlayers = (game.payment_details || []).filter(pd => pd.status === 'paid');
  const totalReceived = paidPlayers.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back to Games
          </button>
          <div className="flex items-center gap-3">
            {sportIcon(game.sport_type)}
            <div>
              <h1 className="text-xl font-bold">{game.title}</h1>
              <div className="flex gap-2 mt-1">
                <Badge className={`${statusColor(game.status)} mt-1`}>{statusLabel(game.status, game.is_archived)}</Badge>
                {game.is_archived && <Badge className="bg-gray-200 text-gray-700 mt-1"><Archive size={10} className="mr-1" /> Archived</Badge>}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}

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
                    You will still need to pay {currency}{game.cost_per_person} even if you quit now.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-700 mb-3">Are you sure you want to quit this game?</p>
              )}
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
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-gray-600"><MapPin size={16} /> <span>{game.ground_name}</span></div>
            <div className="flex items-center gap-2 text-gray-600"><Clock size={16} /> <span>{formatGameDate(game.game_date)} at {formatTime12h(game.game_time)}</span></div>
            {game.duration_minutes > 0 && (
              <div className="flex items-center gap-2 text-gray-600"><Clock size={16} /> <span>Duration: {game.duration_minutes} minutes</span></div>
            )}
            <div className="flex items-center gap-2 text-gray-600"><Users size={16} /> <span>Max {game.max_players} players</span></div>
            <div className="flex items-center gap-2 text-gray-600">
              <DollarSign size={16} /> <span>{game.cost_per_person} {currency} per person ({game.payment_timing === 'before' ? 'PrePaid' : 'PostPaid'})</span>
            </div>
            {game.quit_penalty_hours > 0 && (
              <div className="flex items-center gap-2 text-orange-600">
                <AlertTriangle size={16} /> <span>Quit penalty: Must pay if quitting within {game.quit_penalty_hours}h of game</span>
              </div>
            )}
            {game.payee && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone size={16} /> <span>Pay to: {game.payee.name} ({game.payee.phone})</span>
              </div>
            )}
            <p className="text-xs text-gray-400">Created by {game.created_by_name}</p>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {isAdmin && game.status === 'draft' && (
            <Button className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => handleAction('open-voting', () => api.openVoting(game.id))}
              disabled={actionLoading === 'open-voting'}>
              {actionLoading === 'open-voting' ? 'Opening...' : 'Open Voting'}
            </Button>
          )}

          {game.status === 'voting_open' && !isPlayerInGame && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-4">
                <h4 className="font-semibold text-green-800 mb-2">Join Game</h4>
                {game.payment_timing === 'before' && (
                  <p className="text-xs text-orange-600 mb-2 flex items-center gap-1">
                    <CreditCard size={12} /> PrePaid: Payment required to confirm your spot
                  </p>
                )}
                {positions.length > 0 && (
                  <div className="mb-3">
                    <Label className="text-sm text-gray-600 mb-1 block">Select Position (optional)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {positions.map(pos => (
                        <button key={pos} type="button"
                          onClick={() => setVotePosition(votePosition === pos ? '' : pos)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            votePosition === pos
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                          }`}>{pos}</button>
                      ))}
                    </div>
                  </div>
                )}
                <Button className="w-full bg-green-600 hover:bg-green-700"
                  onClick={async () => {
                    setActionLoading('vote');
                    setError('');
                    try {
                      const result = await api.voteJoin(game.id, votePosition);
                      if (result.is_first_time_on_ground) {
                        setFirstTimeAlert('This is your first time on this ground. Even though this is a PostPaid game, please pay in advance as a deposit.');
                      }
                      await loadGame();
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : 'Action failed');
                    } finally {
                      setActionLoading('');
                    }
                  }}
                  disabled={actionLoading === 'vote'}>
                  {actionLoading === 'vote' ? 'Joining...' : `Join Game${votePosition ? ` as ${votePosition}` : ''}`}
                </Button>
              </CardContent>
            </Card>
          )}

          {(game.status === 'voting_open' || game.status === 'in_progress') && isPlayerInGame && (
            <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50"
              onClick={handleQuitClick} disabled={actionLoading === 'quit'}>
              {actionLoading === 'quit' ? 'Quitting...' : 'Quit Game'}
            </Button>
          )}

          {(isModerator || isAdmin) && game.status === 'voting_open' && availableForNomination.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><UserPlus size={14} /> Nominate Player</h4>
                <div className="flex gap-2 mb-2">
                  <Select value={nominateUserId} onValueChange={setNominateUserId}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select user" /></SelectTrigger>
                    <SelectContent>
                      {availableForNomination.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!nominateUserId || actionLoading === 'nominate'}
                    onClick={() => handleAction('nominate', () => api.nominatePlayer(game.id, Number(nominateUserId), nominatePosition))}>
                    Add
                  </Button>
                </div>
                {positions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {positions.map(pos => (
                      <button key={pos} type="button"
                        onClick={() => setNominatePosition(nominatePosition === pos ? '' : pos)}
                        className={`px-2 py-0.5 rounded-full text-xs border ${
                          nominatePosition === pos ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-500 border-gray-300'
                        }`}>{pos}</button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Edit Game - for Admin/Moderator on non-completed games */}
          {(isModerator || isAdmin) && game.status !== 'completed' && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1"><Pencil size={14} /> Edit Game Settings</h4>
                  <Button size="sm" variant="outline" onClick={() => {
                    setShowEditGame(!showEditGame);
                    if (!showEditGame) {
                      setEditPayeeUserId(game.payee ? String(game.payee.id) : '');
                      setEditQuitPenalty(String(game.quit_penalty_hours || 0));
                      setEditPaymentMode(game.payment_timing === 'before' ? 'prepaid' : 'postpaid');
                      setEditCostPerPerson(String(game.cost_per_person));
                    }
                  }}>
                    {showEditGame ? 'Cancel' : 'Edit'}
                  </Button>
                </div>
                {showEditGame && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-gray-500">Select Payee (who receives the money)</Label>
                      <Select value={editPayeeUserId} onValueChange={setEditPayeeUserId}>
                        <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
                        <SelectContent>
                          {allUsers.map(u => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.phone})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500">Cost Per Person ({currency})</Label>
                      <Input type="number" min="0" step="0.01" value={editCostPerPerson}
                        onChange={e => setEditCostPerPerson(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-gray-500">Quit Penalty (hours before game)</Label>
                        <Input type="number" min="0" max="72" value={editQuitPenalty}
                          onChange={e => setEditQuitPenalty(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">Payment Mode</Label>
                        <Select value={editPaymentMode} onValueChange={setEditPaymentMode}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="postpaid">PostPaid</SelectItem>
                            <SelectItem value="prepaid">PrePaid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button className="w-full bg-blue-600 hover:bg-blue-700"
                      disabled={actionLoading === 'edit-game'}
                      onClick={() => {
                        handleAction('edit-game', () => api.editGame(game.id, {
                          payee_user_id: editPayeeUserId ? Number(editPayeeUserId) : undefined,
                          quit_penalty_hours: parseInt(editQuitPenalty) || 0,
                          payment_mode: editPaymentMode,
                          cost_per_person: parseFloat(editCostPerPerson) || undefined,
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

          {/* Start Game - simplified, payee/penalty/mode already set at create/edit time */}
          {(isModerator || isAdmin) && game.status === 'voting_open' && (
            <Button className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={actionLoading === 'start'}
              onClick={() => handleAction('start', () => api.startGame(game.id))}>
              {actionLoading === 'start' ? 'Starting...' : 'Start Game'}
            </Button>
          )}

          {/* Cancel Game - for Moderator/Admin on active games */}
          {(isModerator || isAdmin) && (game.status === 'voting_open' || game.status === 'in_progress' || game.status === 'draft') && (
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
                    <div className="text-sm text-red-700 space-y-1">
                      <p><strong>Game:</strong> {cancelPreview.title}</p>
                      <p><strong>Ground:</strong> {cancelPreview.ground_name}</p>
                      <p><strong>Date/Time:</strong> {cancelPreview.game_date} at {cancelPreview.game_time}</p>
                      <Separator className="my-2" />
                      <p><strong>Confirmed Players:</strong> {cancelPreview.confirmed_players} of {cancelPreview.total_players} total</p>
                      <p><strong>Players who Paid:</strong> {cancelPreview.paid_players}</p>
                      {cancelPreview.refund_amount > 0 && (
                        <p className="text-red-800 font-semibold">
                          Refund Amount: {cancelPreview.refund_amount} {currency} (will be marked for refund)
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
                        disabled={actionLoading === 'cancel'}
                        onClick={() => {
                          handleAction('cancel', () => api.cancelGame(game.id));
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

          {(isModerator || isAdmin) && game.status === 'in_progress' && (
            <Button className="w-full bg-purple-600 hover:bg-purple-700"
              onClick={() => handleAction('complete', () => api.completeGame(game.id))}
              disabled={actionLoading === 'complete'}>
              {actionLoading === 'complete' ? 'Completing...' : 'Mark Game as Completed'}
            </Button>
          )}

          {/* Payment for current user - PrePaid */}
          {isSelectedPlayer && myPlayerRecord && myPlayerRecord.payment_confirmed !== 1 && game.payment_timing === 'before' && (game.status === 'voting_open' || game.status === 'in_progress') && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="p-4">
                <h4 className="font-semibold text-orange-800 mb-1 flex items-center gap-2">
                  <CreditCard size={16} /> PrePaid - Payment Required
                </h4>
                <p className="text-sm text-orange-700 mb-2">Amount: <strong>{game.cost_per_person} {currency}</strong></p>
                {game.payee && (
                  <p className="text-sm text-orange-700 mb-3">
                    Pay to: <strong>{game.payee.name}</strong> - <a href={`tel:${game.payee.phone}`} className="underline">{game.payee.phone}</a>
                  </p>
                )}
                <Button className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => handleAction('pay', () => api.recordPayment(game.id))}
                  disabled={actionLoading === 'pay'}>
                  {actionLoading === 'pay' ? 'Recording...' : 'Mark as Paid'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Payment for current user - PostPaid */}
          {isSelectedPlayer && myPlayerRecord && myPlayerRecord.payment_confirmed !== 1 && game.payee && game.payment_timing !== 'before' && (game.status === 'in_progress' || game.status === 'completed') && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="p-4">
                <h4 className="font-semibold text-orange-800 mb-1">Payment Due</h4>
                <p className="text-sm text-orange-700 mb-2">Amount: <strong>{game.cost_per_person} {currency}</strong></p>
                <p className="text-sm text-orange-700 mb-3">
                  Pay to: <strong>{game.payee.name}</strong> - <a href={`tel:${game.payee.phone}`} className="underline">{game.payee.phone}</a>
                </p>
                <Button className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => handleAction('pay', () => api.recordPayment(game.id))}
                  disabled={actionLoading === 'pay'}>
                  {actionLoading === 'pay' ? 'Recording...' : 'Mark as Paid'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {canCreateTeams && game.teams.length === 0 && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                <Users size={16} /> Create Teams
              </h4>
              <p className="text-xs text-blue-600 mb-3">
                {game.selected_players.length}/{game.max_players} players confirmed ({Math.round(game.selected_players.length / game.max_players * 100)}% capacity - teams available at 70%+)
              </p>
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
                {teamNames.slice(0, parseInt(teamCount)).map((name, i) => (
                  <Input key={i} value={name}
                    onChange={e => {
                      const updated = [...teamNames];
                      updated[i] = e.target.value;
                      setTeamNames(updated);
                    }}
                    placeholder={`Team ${i + 1} name`} />
                ))}
              </div>
              <Button className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={handleCreateTeams} disabled={actionLoading === 'create-teams'}>
                {actionLoading === 'create-teams' ? 'Creating...' : 'Create Teams'}
              </Button>
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
                  <h5 className="font-semibold text-sm mb-2">{team.team_name}</h5>
                  <div className="space-y-1">
                    {getTeamPlayers(team.id).map(player => (
                      <div key={player.id}
                        draggable={(isAdmin || isModerator) ? true : false}
                        onDragStart={() => handleDragStart(player)}
                        className={`flex items-center gap-2 text-sm p-1.5 bg-white rounded ${(isAdmin || isModerator) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        {(isAdmin || isModerator) && <GripVertical size={12} className="text-gray-400" />}
                        <span className="flex-1">{player.name}</span>
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
                        <span className="flex-1">{player.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} /> Confirmed Players ({game.selected_players.length}/{game.max_players})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {game.selected_players.length === 0 ? (
              <p className="text-sm text-gray-400">No players yet</p>
            ) : (
              <div className="space-y-2">
                {game.selected_players.map((player, idx) => (
                  <div key={player.id} className="flex items-center gap-2 text-sm">
                    <span className="w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </span>
                    <span className="flex-1">
                      {player.name}{player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
                    </span>
                    {/* Nomination info tooltip */}
                    <button
                      type="button"
                      className="relative text-gray-400 hover:text-blue-500 transition-colors"
                      onClick={() => setTooltipPlayerId(tooltipPlayerId === player.id ? null : player.id)}
                      title={player.nominated_by_info || 'Self Nominated'}
                    >
                      <Info size={14} />
                      {tooltipPlayerId === player.id && (
                        <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-10">
                          {player.nominated_by_info || 'Self Nominated'}
                        </span>
                      )}
                    </button>
                    {/* Payment status icon */}
                    {player.payment_confirmed === 1 ? (
                      <span className="text-green-600" title="Paid">
                        <Banknote size={16} />
                      </span>
                    ) : (
                      <span className="text-gray-300" title="Unpaid">
                        <Banknote size={16} />
                      </span>
                    )}
                    {player.user_id === user?.id && <Badge className="bg-green-100 text-green-700 text-xs">You</Badge>}
                    {(isModerator || isAdmin) && player.payment_confirmed !== 1 && (game.status === 'completed' || game.status === 'in_progress') && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-green-600 border-green-300"
                        onClick={() => handleAction(`mark-paid-${player.user_id}`, () => api.markPaymentMade(game.id, player.user_id))}
                        disabled={actionLoading === `mark-paid-${player.user_id}`}>
                        {actionLoading === `mark-paid-${player.user_id}` ? '...' : 'Mark Paid'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {game.waiting_list.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-orange-600">
                <Clock size={16} /> Waiting List ({game.waiting_list.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {game.waiting_list.map((player, idx) => (
                  <div key={player.id} className="flex items-center gap-2 text-sm">
                    <span className="w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </span>
                    <span className="flex-1">
                      {player.name}{player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
                    </span>
                    {player.user_id === user?.id && <Badge className="bg-orange-100 text-orange-700 text-xs">You</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment Tracking */}
        {(game.payment_summary.total > 0 || (game.payment_details && game.payment_details.length > 0)) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><DollarSign size={16} /> Payment Tracking</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-gray-800">{game.cost_per_person * game.max_players} {currency}</p>
                  <p className="text-xs text-gray-500">Total Outstanding</p>
                </div>
                <div className="bg-green-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-green-600">{totalReceived} {currency}</p>
                  <p className="text-xs text-gray-500">Received</p>
                </div>
                <div className="bg-red-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-red-600">{game.cost_per_person * game.max_players - totalReceived} {currency}</p>
                  <p className="text-xs text-gray-500">Pending</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div><p className="text-2xl font-bold text-gray-800">{game.payment_summary.total}</p><p className="text-xs text-gray-500">Total Players</p></div>
                <div><p className="text-2xl font-bold text-green-600">{game.payment_summary.paid}</p><p className="text-xs text-gray-500">Paid</p></div>
                <div><p className="text-2xl font-bold text-red-600">{game.payment_summary.pending}</p><p className="text-xs text-gray-500">Pending</p></div>
              </div>

              {unpaidPlayers.length > 0 && (isModerator || isAdmin) && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-600 mb-2">Pending Payments:</p>
                  <div className="space-y-1">
                    {unpaidPlayers.map(p => (
                      <div key={p.user_id} className="flex items-center gap-2 text-sm bg-red-50 p-2 rounded">
                        <span className="flex-1">{p.name}</span>
                        <span className="text-red-600 font-medium">{p.amount} {currency}</span>
                      </div>
                    ))}
                  </div>
                  <Button className="w-full mt-3 bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      const msg = `Payment Reminder\n\nGame: ${game.title}\nGround: ${game.ground_name}\nAmount: ${game.cost_per_person} ${currency}\n\nPlease make the payment at the earliest.${game.payee ? `\nPay to: ${game.payee.name} (${game.payee.phone})` : ''}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                      handleAction('remind', () => api.remindUnpaid(game.id));
                    }}
                    disabled={actionLoading === 'remind'}>
                    <MessageCircle size={16} className="mr-2" />
                    {actionLoading === 'remind' ? 'Sending...' : 'Remind Unpaid via WhatsApp'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {game.status === 'completed' && isSelectedPlayer && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-yellow-700"><Star size={16} /> Vote Player of the Day</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex gap-2">
                <Select value={potdPlayerId} onValueChange={setPotdPlayerId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select best player" /></SelectTrigger>
                  <SelectContent>
                    {game.selected_players.filter(p => p.user_id !== user?.id).map(p => (
                      <SelectItem key={p.user_id} value={String(p.user_id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700"
                  disabled={!potdPlayerId || actionLoading === 'potd'}
                  onClick={() => handleAction('potd', () => api.votePOTD(game.id, Number(potdPlayerId)))}>
                  Vote
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {game.status === 'completed' && potdResults.length > 0 && (
          <Card className="border-yellow-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Trophy size={16} className="text-yellow-500" /> Man of the Match</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {potdResults.map((r, idx) => (
                <div key={r.player_id} className="flex items-center gap-2 mb-2">
                  {idx === 0 ? <Trophy size={20} className="text-yellow-500" /> : <span className="w-5 h-5 text-center text-xs text-gray-400">{idx + 1}</span>}
                  <span className={`flex-1 ${idx === 0 ? 'font-bold text-yellow-700' : 'text-gray-600'}`}>{r.name}</span>
                  <Badge variant={idx === 0 ? 'default' : 'outline'} className={idx === 0 ? 'bg-yellow-500' : ''}>
                    {r.votes} {r.votes === 1 ? 'vote' : 'votes'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {(isModerator || isAdmin) && (game.status === 'voting_open' || game.status === 'in_progress') && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <h4 className="font-semibold text-green-800 mb-2 flex items-center gap-2"><Share2 size={16} /> Send Current Status</h4>
              <div className="bg-white rounded-lg p-3 text-sm font-mono whitespace-pre-wrap mb-3 border">
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
            </CardContent>
          </Card>
        )}

        <Separator />
        <p className="text-xs text-gray-400 text-center pb-4">Game ID: {game.id}</p>
      </div>
    </div>
  );
}
