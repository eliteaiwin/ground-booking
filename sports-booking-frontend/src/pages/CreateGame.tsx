import { useState, useEffect } from 'react';
import { formatPhone } from '@/lib/phone';
import { useAuth } from '../context/AuthContext';
import CostBreakdown from '@/components/CostBreakdown';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Search, X, UserPlus, ChevronDown, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useSports } from '../lib/sports';
import PitchSelect from '@/components/grounds/PitchSelect';
import { defaultPitchValue, parsePitchValue, type PitchLayout } from '@/lib/grounds';

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
  pitch_layouts?: Record<string, PitchLayout[]>;
}

const SPORT_DURATIONS: Record<string, number> = {
  soccer: 90,
  cricket: 180,
  badminton: 60,
  basketball: 60,
  hockey: 70,
  pickleball: 60,
  tennis: 60,
  swimming: 60,
};

interface Props {
  onBack: () => void;
  onCreated: (gameId: number) => void;
}

interface MyAllotment {
  id: number;
  ground_name: string;
  sport_type: string;
  allot_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  pitch_format: string | null;
  pitch_number: number | null;
  pitch_label: string;
  group_name: string | null;
  rent?: number;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

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
  const [paymentCollection, setPaymentCollection] = useState('offline');
  const [defaultPayee, setDefaultPayee] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [showQuitPenalty, setShowQuitPenalty] = useState(false);
  const [quitPenaltyHours, setQuitPenaltyHours] = useState('0');
  const [showPayeeInfo, setShowPayeeInfo] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const [pitch, setPitch] = useState('');
  const [allotments, setAllotments] = useState<MyAllotment[]>([]);
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<UserItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showPreAdd, setShowPreAdd] = useState(false);
  const [noteBefore, setNoteBefore] = useState('');
  const [noteAfter, setNoteAfter] = useState('');

  const currency = user?.currency || 'Rs';


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
      api.getGameDefaults().then((d: { default_payee: { id: number; name: string; phone: string } | null; show_quit_penalty: boolean; default_quit_penalty_hours: number }) => {
        setDefaultPayee(d.default_payee);
        setShowQuitPenalty(d.show_quit_penalty);
        setQuitPenaltyHours(String(d.default_quit_penalty_hours));
      }).catch(() => {}),
      api.myAllotments().then((a: MyAllotment[]) => setAllotments(a)).catch(() => {}),
    ]);
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

  const layoutsFor = (ground: string, sport: string) =>
    grounds.find(g => g.display_name === ground)?.pitch_layouts?.[sport] || [];
  const pitchLayouts = layoutsFor(groundName, sportType);

  const chosenGround = groundName === '__other__' ? customGround : groundName;
  const startMinute = gameTime ? toMinutes(gameTime) : -1;
  const endMinute = startMinute + (parseInt(durationMinutes) || 0);
  const chosenPitch = pitchLayouts.length > 0 ? parsePitchValue(pitch) : { pitch_format: '', pitch_number: 0 };
  const matchingAllotment = allotments.find(a =>
    a.ground_name === chosenGround &&
    a.sport_type === sportType &&
    a.allot_date === gameDate &&
    toMinutes(a.start_time) <= startMinute &&
    endMinute <= toMinutes(a.start_time) + a.duration_minutes &&
    (!chosenPitch.pitch_format || chosenPitch.pitch_format === a.pitch_format) &&
    (!chosenPitch.pitch_number || chosenPitch.pitch_number === a.pitch_number));
  const notAllotted = !!chosenGround && !!gameDate && !!gameTime && !matchingAllotment;

  const applyAllotment = (a: MyAllotment) => {
    const known = grounds.some(g => g.display_name === a.ground_name);
    setSportType(a.sport_type);
    setGroundName(known ? a.ground_name : '__other__');
    if (!known) setCustomGround(a.ground_name);
    setGameDate(a.allot_date);
    setGameTime(a.start_time);
    setDurationMinutes(String(a.duration_minutes));
    setPitch(a.pitch_format ? `${a.pitch_format}|${a.pitch_number}` : '');
    if (sportDefaults[a.sport_type]) setMaxPlayers(String(sportDefaults[a.sport_type]));
    if (a.rent && !groundCost) setGroundCost(String(a.rent));
  };

  const handleSportChange = (val: string) => {
    setSportType(val);
    setPitch(defaultPitchValue(layoutsFor(groundName, val)));
    if (sportDefaults[val]) {
      setMaxPlayers(String(sportDefaults[val]));
    }
    if (SPORT_DURATIONS[val]) {
      setDurationMinutes(String(SPORT_DURATIONS[val]));
    }
  };

  const handleGroundChange = (val: string) => {
    setGroundName(val);
    setPitch(defaultPitchValue(layoutsFor(val, sportType)));
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
    if (notAllotted && !window.confirm('The Ground Manager has not allotted this ground to you for this time. Create the game anyway?')) {
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
        payment_mode: paymentTiming === 'before' ? 'prepaid' : 'postpaid',
        ...(showQuitPenalty ? { quit_penalty_hours: parseInt(quitPenaltyHours) || 0 } : {}),
        payment_collection: paymentCollection,
        note_before_players: noteBefore || undefined,
        note_after_players: noteAfter || undefined,
        ...(pitchLayouts.length > 0 ? parsePitchValue(pitch) : {}),
        ...(matchingAllotment ? { allotment_id: matchingAllotment.id } : {}),
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
              {allotments.length > 0 && (
                <div className="space-y-1">
                  <Label>Your allotted slots</Label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {allotments.slice(0, 12).map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => applyAllotment(a)}
                        className={`shrink-0 text-left rounded-lg border px-3 py-2 text-xs ${matchingAllotment?.id === a.id ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                      >
                        <div className="font-semibold">{a.allot_date} · {a.start_time}–{a.end_time}</div>
                        <div>{a.pitch_label || 'Whole ground'} · {a.ground_name}</div>
                        {a.group_name && <div className="text-gray-500">{a.group_name}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
              <PitchSelect layouts={pitchLayouts} value={pitch} onChange={setPitch} />
              {matchingAllotment && (
                <div className="flex gap-2 items-start bg-green-50 text-green-800 p-3 rounded-md text-sm">
                  <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Ground Manager confirmed {matchingAllotment.pitch_label || 'the ground'} for you ({matchingAllotment.start_time}–{matchingAllotment.end_time}{matchingAllotment.group_name ? `, ${matchingAllotment.group_name}` : ''}).
                  </span>
                </div>
              )}
              {notAllotted && (
                <div className="flex gap-2 items-start bg-amber-50 text-amber-800 p-3 rounded-md text-sm">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    No confirmation from the Ground Manager: this ground isn't allotted to you{chosenPitch.pitch_format ? ` (${chosenPitch.pitch_format})` : ''} at this time. Check with the Ground Manager before inviting players.
                  </span>
                </div>
              )}
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
                  <Label htmlFor="groundCost">Ground Fee ({currency})</Label>
                  <Input id="groundCost" type="number" min="0" step="0.01" placeholder="0.00" value={groundCost} onChange={(e) => setGroundCost(e.target.value)} required />
                </div>
              </div>
              <CostBreakdown groundCost={parseFloat(groundCost) || 0} players={parseInt(maxPlayers) || 0} collection={paymentCollection} currency={currency} />
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
                            <span className="text-xs text-gray-400">{formatPhone(u.phone)}</span>
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

              <div className="space-y-2">
                <Label>How to pay</Label>
                <Select value={paymentCollection} onValueChange={setPaymentCollection}>
                  <SelectTrigger data-testid="payment-collection"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="offline">Track offline (cash / UPI to receiver)</SelectItem>
                    <SelectItem value="app">Pay through the app</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">Players set to "Pay first" in their profile must pay before their name is added.</p>
              </div>
              {showQuitPenalty && (
                <div className="space-y-2" data-testid="quit-penalty-field">
                  <Label>Quit penalty (hours before game)</Label>
                  <Input type="number" min="0" max="72" value={quitPenaltyHours} onChange={e => setQuitPenaltyHours(e.target.value)} />
                  <p className="text-xs text-gray-500">Players who quit within this time before the game still pay their share.</p>
                </div>
              )}
              <div className="space-y-1" data-testid="default-payee">
                <div className="text-sm text-gray-700 flex items-center gap-1.5">
                  <span>Payment Receiver: <strong>{defaultPayee ? defaultPayee.name : 'Not set'}</strong></span>
                  <button type="button" aria-label="About the payment receiver" onClick={() => setShowPayeeInfo(v => !v)} className="text-gray-400 hover:text-green-600">
                    <Info size={14} />
                  </button>
                </div>
                {showPayeeInfo && (
                  <p className="text-xs text-gray-500">A moderator can change the receiver in <strong>Preferences → Game Defaults</strong>.</p>
                )}
              </div>
              <div className="border rounded-md overflow-hidden">
                <button type="button" onClick={() => setShowOptions(v => !v)} data-testid="additional-options"
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">
                  <span>Additional options</span>
                  <ChevronDown size={16} className={`transition-transform ${showOptions ? 'rotate-180' : ''}`} />
                </button>
                {showOptions && (
                  <div className="p-3">
                      <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-sm">Note before player list (optional)</Label>
                      <Textarea value={noteBefore} onChange={e => setNoteBefore(e.target.value)} rows={2} className="text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Note after player list (optional)</Label>
                      <Textarea value={noteAfter} onChange={e => setNoteAfter(e.target.value)} rows={2} className="text-sm" />
                    </div>
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
