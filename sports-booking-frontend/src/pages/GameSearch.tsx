import { useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, Users, Trophy, Calendar, MapPin, Clock } from 'lucide-react';

interface Player {
  user_id: number;
  name: string;
  phone: string;
  position: string;
  status: string;
  payment_confirmed: number;
}

interface GameResult {
  id: number;
  title: string;
  sport_type: string;
  ground_name: string;
  game_date: string;
  game_time: string;
  status: string;
  max_players: number;
  cost_per_person: number;
  duration_minutes: number;
  selected_players: Player[];
  waiting_list: Player[];
  player_of_the_day: { player_id: number; name: string; votes: number } | null;
  payment_summary: { total: number; paid: number; pending: number };
}

const maskPhone = (phone?: string) => {
  if (!phone || phone.length < 4) return phone || '';
  return phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
};

const formatNamePhone = (name: string, phone?: string) => {
  const firstName = (name || '').split(' ')[0];
  const masked = maskPhone(phone);
  return masked ? `${firstName} - ${masked}` : firstName;
};

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
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

const statusLabel = (status: string) => {
  switch (status) {
    case 'draft': return 'Draft';
    case 'voting_open': return 'Open for Voting';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
};

interface Props {
  onBack: () => void;
  onViewGame?: (gameId: number) => void;
}

export default function GameSearch({ onBack, onViewGame }: Props) {
  const { user } = useAuth();
  const [searchDate, setSearchDate] = useState('');
  const [searchGround, setSearchGround] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchSport, setSearchSport] = useState('');
  const [results, setResults] = useState<GameResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);

  const currency = user?.currency || 'Rs';

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await api.searchGames({
        date: searchDate || undefined,
        ground: searchGround || undefined,
        status: searchStatus && searchStatus !== 'all' ? searchStatus : undefined,
        sport: searchSport && searchSport !== 'all' ? searchSport : undefined,
      });
      setResults(data);
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Search size={20} /> Search Games
          </h1>
          <p className="text-sm text-green-100 mt-1">Find games by date, ground, status or sport</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Ground</Label>
                <Input placeholder="e.g. Whitefield" value={searchGround}
                  onChange={e => setSearchGround(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={searchStatus} onValueChange={setSearchStatus}>
                  <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="voting_open">Open for Voting</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sport</Label>
                <Select value={searchSport} onValueChange={setSearchSport}>
                  <SelectTrigger><SelectValue placeholder="All sports" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="soccer">Soccer</SelectItem>
                    <SelectItem value="cricket">Cricket</SelectItem>
                    <SelectItem value="badminton">Badminton</SelectItem>
                    <SelectItem value="basketball">Basketball</SelectItem>
                    <SelectItem value="hockey">Hockey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSearch} disabled={loading} className="w-full bg-green-600 hover:bg-green-700">
              <Search size={16} className="mr-2" />
              {loading ? 'Searching...' : 'Search Games'}
            </Button>
          </CardContent>
        </Card>

        {searched && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{results.length} game{results.length !== 1 ? 's' : ''} found</p>
            {results.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  <Calendar size={24} className="mx-auto mb-2 text-gray-400" />
                  No games found. Try different filters.
                </CardContent>
              </Card>
            )}
            {results.map(game => (
              <Card key={game.id} className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setExpandedGame(expandedGame === game.id ? null : game.id)}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-1">{sportIcon(game.sport_type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-800 truncate">{game.title || game.ground_name}</h3>
                        <Badge className={`${statusColor(game.status)} text-xs shrink-0`}>
                          {statusLabel(game.status)}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-500 space-y-0.5">
                        <p className="flex items-center gap-1"><MapPin size={12} /> {game.ground_name}</p>
                        <p className="flex items-center gap-1">
                          <Calendar size={12} /> {game.game_date}
                          <Clock size={12} className="ml-2" /> {game.game_time}
                          {game.duration_minutes > 0 && ` (${game.duration_minutes} mins)`}
                        </p>
                        <p className="flex items-center gap-1">
                          <Users size={12} /> {game.selected_players.length}/{game.max_players} players
                          {game.waiting_list.length > 0 && (
                            <span className="text-orange-500 ml-1">+{game.waiting_list.length} waiting</span>
                          )}
                          <span className="ml-2">{game.cost_per_person} {currency}/person</span>
                        </p>
                      </div>

                      {game.player_of_the_day && (
                        <div className="mt-2 text-xs text-yellow-600 font-medium flex items-center gap-1">
                          <Trophy size={12} />
                          Man of the Match: {game.player_of_the_day.name} ({game.player_of_the_day.votes} votes)
                        </div>
                      )}

                      {expandedGame === game.id && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          {game.selected_players.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">Confirmed Players:</p>
                              <div className="flex flex-wrap gap-1">
                                {game.selected_players.map(p => (
                                  <Badge key={p.user_id} variant="outline" className="text-xs">
                                    {formatNamePhone(p.name, p.phone)}
                                    {p.position && p.position !== 'Anywhere' && ` (${p.position})`}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {game.waiting_list.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-orange-600 mb-1">Waiting List:</p>
                              <div className="flex flex-wrap gap-1">
                                {game.waiting_list.map(p => (
                                  <Badge key={p.user_id} variant="outline" className="text-xs border-orange-200">
                                    {formatNamePhone(p.name, p.phone)}
                                    {p.position && p.position !== 'Anywhere' && ` (${p.position})`}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {game.status === 'completed' && (
                            <div className="text-xs text-gray-500">
                              <p>Payments: {game.payment_summary.paid} paid, {game.payment_summary.pending} pending</p>
                            </div>
                          )}
                          {onViewGame && (
                            <Button size="sm" variant="outline" className="w-full mt-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); onViewGame(game.id); }}>
                              View Full Details
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
