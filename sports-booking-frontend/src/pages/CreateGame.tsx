import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';

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
  const [title, setTitle] = useState('');
  const [sportType, setSportType] = useState('soccer');
  const [groundName, setGroundName] = useState('');
  const [customGround, setCustomGround] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameTime, setGameTime] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('10');
  const [costPerPerson, setCostPerPerson] = useState('');
  const [paymentTiming, setPaymentTiming] = useState('after');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sportDefaults, setSportDefaults] = useState<Record<string, number>>({});
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [payeeUserId, setPayeeUserId] = useState('');
  const [quitPenaltyHours, setQuitPenaltyHours] = useState('0');
  const [paymentMode, setPaymentMode] = useState('postpaid');
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);

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
      api.listUsers().then((u: UserItem[]) => setAllUsers(u)).catch(() => {}),
    ]);
  }, []);

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
        cost_per_person: parseFloat(costPerPerson),
        payment_timing: paymentTiming,
        duration_minutes: parseInt(durationMinutes) || 90,
        payee_user_id: payeeUserId ? Number(payeeUserId) : undefined,
        quit_penalty_hours: parseInt(quitPenaltyHours) || 0,
        payment_mode: paymentMode,
      });
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
                <Label htmlFor="title">Game Title</Label>
                <Input id="title" placeholder="e.g. Wednesday Football" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Sport Type</Label>
                <Select value={sportType} onValueChange={handleSportChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soccer"><span className="flex items-center gap-2">&#9917; Soccer</span></SelectItem>
                    <SelectItem value="cricket"><span className="flex items-center gap-2">&#127951; Cricket</span></SelectItem>
                    <SelectItem value="badminton"><span className="flex items-center gap-2">&#127992; Badminton</span></SelectItem>
                    <SelectItem value="basketball"><span className="flex items-center gap-2">&#127936; Basketball</span></SelectItem>
                    <SelectItem value="hockey"><span className="flex items-center gap-2">&#127954; Hockey</span></SelectItem>
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
                  <Input id="maxPlayers" type="number" min="2" max="100" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} required />
                  {sportDefaults[sportType] && (
                    <p className="text-xs text-gray-400">Default for {sportType}: {sportDefaults[sportType]}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cost">Cost Per Person ({currency})</Label>
                  <Input id="cost" type="number" min="0" step="0.01" placeholder="0.00" value={costPerPerson} onChange={(e) => setCostPerPerson(e.target.value)} required />
                </div>
              </div>
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
              <Separator className="my-2" />
              <h3 className="text-sm font-semibold text-gray-700">Payment & Rules</h3>
              <div className="space-y-2">
                <Label>Select Payee (who receives the money)</Label>
                <Select value={payeeUserId} onValueChange={setPayeeUserId}>
                  <SelectTrigger><SelectValue placeholder="Select payee (optional)" /></SelectTrigger>
                  <SelectContent>
                    {allUsers.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.phone})</SelectItem>
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
