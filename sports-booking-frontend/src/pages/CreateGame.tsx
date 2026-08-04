import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Search, X, UserPlus, ChevronDown } from 'lucide-react';
import { useSports } from '../lib/sports';

interface UserItem {
  id: number;
  name: string;
  phone: string;
  roles: string[];
}

interface Ground {
  id: number;
  name: string;
  location: string;
  display_name: string;
}

const formatUserOption = (name: string, phone: string) => {
  const firstName = name.split(' ')[0];
  if (!phone || phone.length < 4) return firstName;
  const masked = phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
  return `${firstName} - ${masked}`;
};

const SPORT_DURATIONS: Record<string, number> = {
  soccer: 90,
  cricket: 180,
  badminton: 60,
  basketball: 60,
  hockey: 70,
};

interface Props {
  onBack: () => void;
  onCreated: (gameId: number) => void;
}

export default function CreateGame({ onBack, onCreated }: Props) {
  const { user } = useAuth();
  const sports = useSports();
  const [titleType, setTitleType] = useState('regular');
  const [title, setTitle] = useState('');
  const [sportType, setSportType] = useState('soccer');
  const [groundName, setGroundName] = useState('');
  const [customGround, setCustomGround] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameTime, setGameTime] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('10');
  const [groundCost, setGroundCost] = useState('');
  const [paymentTiming, setPaymentTiming] = useState('after');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sportDefaults, setSportDefaults] = useState<Record<string, number>>({});
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [payeeUserId, setPayeeUserId] = useState('');
  const [quitPenaltyHours, setQuitPenaltyHours] = useState('0');
  const [paymentMode, setPaymentMode] = useState('postpaid');
  const [potdDelayMinutes, setPotdDelayMinutes] = useState('1440');
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<UserItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showPotd, setShowPotd] = useState(false);
  const [showPreAdd, setShowPreAdd] = useState(false);
  const [showPaymentRules, setShowPaymentRules] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [noteBefore, setNoteBefore] = useState('');
  const [noteAfter, setNoteAfter] = useState('');

  const currency = user?.currency || 'Rs';

  const costPerPerson = (() => {
    const total = parseFloat(groundCost) || 0;
    const players = parseInt(maxPlayers) || 1;
    if (total <= 0 || players <= 0) return '';
    return (total / players).toFixed(2);
  })();

  useEffect(() => {
    Promise.all([
      api.getPreferences().then((prefs: { sport_type: string; default_max_players: number }[]) => {
        const defaults: Record<string, number> = {};
        prefs.forEach((p: { sport_type: string; default_max_players: number }) => {
          defaults[p.sport_type] = p.default_max_players;
        });
        setSportDefaults(defaults);
        if (defaults[sportType]) {
          setMaxPlayers(String(defaults[sportType]));
        }
      }).catch(() => {}),
      api.listGrounds().then((g: Ground[]) => setGrounds(g)).catch(() => {}),
      api.listUsers().then((u: UserItem[]) => setAllUsers(u)).catch(() => {}),
    ]);
    // Load previous POTD delay from last game created by this user
    api.listGames().then((games: { potd_congrats_delay_minutes?: number }[]) => {
      if (games.length > 0 && games[0].potd_congrats_delay_minutes) {
        setPotdDelayMinutes(String(games[0].potd_congrats_delay_minutes));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!playerSearch.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api.searchUsers({ search: playerSearch.trim() })
        .then((users: UserItem[]) => setSearchResults(users.filter(u => !selectedPlayers.some(p => p.id === u.id))))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [playerSearch, selectedPlayers]);

  useEffect(() => {
    if (sports.length > 0 && !sports.find(s => s.key === sportType)) {
      setSportType(sports[0].key);
      if (sportDefaults[sports[0].key]) {
        setMaxPlayers(String(sportDefaults[sports[0].key]));
      }
      if (SPORT_DURATIONS[sports[0].key]) {
        setDurationMinutes(String(SPORT_DURATIONS[sports[0].key]));
      }
    }
  }, [sports, sportType, sportDefaults]);

  const handleSportChange = (val: string) => {
    setSportType(val);
    if (sportDefaults[val]) {
      setMaxPlayers(String(sportDefaults[val]));
    }
    if (SPORT_DURATIONS[val]) {
      setDurationMinutes(String(SPORT_DURATIONS[val]));
    }
  };

  const handleGroundChange = (val: string) => {
    setGroundName(val);
    if (val !== '__other__') {
      setCustomGround('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const finalGround = groundName === '__other__' ? customGround : groundName;
    if (!finalGround.trim()) {
      setError('Please select or enter a ground name');
      setLoading(false);
      return;
    }
    try {
      const game = await api.createGame({
        title,
        sport_type: sportType,
        ground_name: finalGround,
        game_date: gameDate,
        game_time: gameTime,
        max_players: parseInt(maxPlayers),
        ground_cost: parseFloat(groundCost) || 0,
        payment_timing: paymentTiming,
        duration_minutes: parseInt(durationMinutes) || 90,
        payee_user_id: payeeUserId ? Number(payeeUserId) : undefined,
        quit_penalty_hours: parseInt(quitPenaltyHours) || 0,
        payment_mode: paymentMode,
        potd_congrats_delay_minutes: parseInt(potdDelayMinutes) || 1440,
        note_before_players: noteBefore || undefined,
        note_after_players: noteAfter || undefined,
      });

      // Pre-add selected players while game is still in draft
      if (selectedPlayers.length > 0) {
        const max = parseInt(maxPlayers) || 10;
        const toAdd = selectedPlayers.slice(0, max);
        await Promise.all(
          toAdd.map(p =>
            api.nominatePlayer(game.id, p.id).catch(() => null)
          )
        );
      }

      onCreated(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
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
          <h1 className="text-xl font-bold">Create New Game</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Game Details</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}
              <div className="space-y-2">
                <Label>Game Title</Label>
                <Select value={titleType} onValueChange={(val) => { setTitleType(val); if (val === 'regular') setTitle(''); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular Games</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {titleType === 'other' && (
                  <Input id="title" placeholder="Enter game title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                )}
              </div>
              <div className="space-y-2">
                <Label>Sport Type</Label>
                <Select value={sportType} onValueChange={handleSportChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sports.map(s => (
                      <SelectItem key={s.key} value={s.key}>
                        <span className="flex items-center gap-2">{s.icon} {s.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ground / Venue</Label>
                <Select value={groundName} onValueChange={handleGroundChange}>
                  <SelectTrigger><SelectValue placeholder="Select a ground" /></SelectTrigger>
                  <SelectContent>
                    {grounds.map(g => (
                      <SelectItem key={g.id} value={g.display_name}>{g.display_name}</SelectItem>
                    ))}
                    <SelectItem value="__other__">Other (Type below)</SelectItem>
                  </SelectContent>
                </Select>
                {groundName === '__other__' && (
                  <Input placeholder="Enter ground name" value={customGround} onChange={(e) => setCustomGround(e.target.value)} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Time</Label>
                  <Input id="time" type="time" value={gameTime} onChange={(e) => setGameTime(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxPlayers">Max Players</Label>
                  <Input id="maxPlayers" type="number" min="2" max={sportDefaults[sportType] || 100} value={maxPlayers} onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const cap = sportDefaults[sportType] || 100;
                    setMaxPlayers(String(Math.min(Math.max(val, 2), cap)));
                  }} required />
                  {sportDefaults[sportType] && (
                    <p className="text-xs text-gray-400">Maximum for {sportType}: {sportDefaults[sportType]}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="groundCost">Ground Cost ({currency})</Label>
                  <Input id="groundCost" type="number" min="0" step="0.01" placeholder="0.00" value={groundCost} onChange={(e) => setGroundCost(e.target.value)} required />
                </div>
              </div>
              {costPerPerson && (
                <div className="p-2 bg-green-50 rounded text-sm text-green-800">
                  Cost per player: <span className="font-semibold">{costPerPerson} {currency}</span> (read-only, based on max players)
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duration">Duration (minutes)</Label>
                  <Input id="duration" type="number" min="15" max="600" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
                  <p className="text-xs text-gray-400">Default: {SPORT_DURATIONS[sportType] || 90} mins</p>
                </div>
                <div className="space-y-2">
                  <Label>Payment Timing</Label>
                  <Select value={paymentTiming} onValueChange={setPaymentTiming}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">Before the Game</SelectItem>
                      <SelectItem value="after">After the Game</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <button type="button" onClick={() => setShowPotd(v => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">
                  <span>POTD Settings</span>
                  <ChevronDown size={16} className={`transition-transform ${showPotd ? 'rotate-180' : ''}`} />
                </button>
                {showPotd && (
                  <div className="p-3 space-y-2">
                    <Label htmlFor="potdDelay">POTD Congratulation Delay (minutes)</Label>
                    <Input id="potdDelay" type="number" min="1" max="10080" value={potdDelayMinutes}
                      onChange={(e) => setPotdDelayMinutes(e.target.value)} />
                    <p className="text-xs text-gray-400">Default: 1440 minutes (24 hours). Time after game completion to announce POTD winner.</p>
                  </div>
                )}
              </div>

              <div className="border rounded-md overflow-hidden">
                <button type="button" onClick={() => setShowPreAdd(v => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">
                  <span className="flex items-center gap-2"><UserPlus size={16} /> Pre-Add Players</span>
                  <ChevronDown size={16} className={`transition-transform ${showPreAdd ? 'rotate-180' : ''}`} />
                </button>
                {showPreAdd && (
                  <div className="p-3 space-y-2">
                    <Label>Search players by name or phone</Label>
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                      <Input
                        placeholder="Type first few characters..."
                        value={playerSearch}
                        onChange={(e) => setPlayerSearch(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    {searching && <p className="text-xs text-gray-500">Searching...</p>}
                    {searchResults.length > 0 && (
                      <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                        {searchResults.map(u => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setSelectedPlayers(prev => [...prev, u]);
                              setPlayerSearch('');
                              setSearchResults([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex justify-between items-center"
                          >
                            <span>{u.name || u.phone}</span>
                            <span className="text-xs text-gray-400">{u.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedPlayers.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selectedPlayers.map(p => (
                          <span key={p.id} className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                            {p.name || p.phone}
                            <button type="button" onClick={() => setSelectedPlayers(prev => prev.filter(x => x.id !== p.id))}>
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border rounded-md overflow-hidden">
                <button type="button" onClick={() => setShowPaymentRules(v => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">
                  <span>Payment & Rules</span>
                  <ChevronDown size={16} className={`transition-transform ${showPaymentRules ? 'rotate-180' : ''}`} />
                </button>
                {showPaymentRules && (
                  <div className="p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>Payment Receiver (who receives the money)</Label>
                      <Select value={payeeUserId} onValueChange={setPayeeUserId}>
                        <SelectTrigger><SelectValue placeholder="Select payment receiver" /></SelectTrigger>
                        <SelectContent>
                          {allUsers.map(u => (
                            <SelectItem key={u.id} value={String(u.id)}>{formatUserOption(u.name, u.phone)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Quit Penalty (hours before game)</Label>
                        <Input type="number" min="0" max="72" value={quitPenaltyHours}
                          onChange={e => setQuitPenaltyHours(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Payment Mode</Label>
                        <Select value={paymentMode} onValueChange={setPaymentMode}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="postpaid">PostPaid</SelectItem>
                            <SelectItem value="prepaid">PrePaid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="border rounded-md overflow-hidden">
                <button type="button" onClick={() => setShowNotes(v => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">
                  <span>Additional Notes (optional)</span>
                  <ChevronDown size={16} className={`transition-transform ${showNotes ? 'rotate-180' : ''}`} />
                </button>
                {showNotes && (
                  <div className="p-3 space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Note before player list</Label>
                      <Textarea value={noteBefore} onChange={e => setNoteBefore(e.target.value)} rows={2} className="text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Note after player list</Label>
                      <Textarea value={noteAfter} onChange={e => setNoteAfter(e.target.value)} rows={2} className="text-sm" />
                    </div>
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                {loading ? 'Creating...' : 'Create Game'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
