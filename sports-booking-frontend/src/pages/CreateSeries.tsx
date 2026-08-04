import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
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

const SPORT_DURATIONS: Record<string, number> = {
  soccer: 90,
  cricket: 180,
  badminton: 60,
  basketball: 60,
  hockey: 70,
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const formatUserOption = (name: string, phone: string) => {
  const firstName = name.split(' ')[0];
  if (!phone || phone.length < 4) return firstName;
  const masked = phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
  return `${firstName} - ${masked}`;
};

interface Props {
  onBack: () => void;
}

export default function CreateSeries({ onBack }: Props) {
  const { user } = useAuth();
  const sports = useSports();
  const [seriesName, setSeriesName] = useState('');
  const [sportType, setSportType] = useState('soccer');
  const [groundName, setGroundName] = useState('');
  const [customGround, setCustomGround] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('16');
  const [groundCost, setGroundCost] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [paymentMode, setPaymentMode] = useState('postpaid');
  const [potdDelayMinutes, setPotdDelayMinutes] = useState('1440');
  const [payeeUserId, setPayeeUserId] = useState('');
  const [quitPenaltyHours, setQuitPenaltyHours] = useState('0');
  const [weeks, setWeeks] = useState('4');
  const [startDate, setStartDate] = useState('');
  const [recurrenceDays, setRecurrenceDays] = useState<{ day: string; time: string }[]>([
    { day: 'Wednesday', time: '20:00' },
    { day: 'Sunday', time: '19:00' },
  ]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [sportDefaults, setSportDefaults] = useState<Record<string, number>>({});

  const currency = user?.currency || 'Rs';

  const costPerPerson = (() => {
    const total = parseFloat(groundCost) || 0;
    const players = parseInt(maxPlayers) || 1;
    if (total <= 0 || players <= 0) return '';
    return (total / players).toFixed(2);
  })();

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);

    Promise.all([
      api.getPreferences().then((prefs: { sport_type: string; default_max_players: number }[]) => {
        const defaults: Record<string, number> = {};
        prefs.forEach((p) => { defaults[p.sport_type] = p.default_max_players; });
        setSportDefaults(defaults);
      }).catch(() => {}),
      api.listGrounds().then((g: Ground[]) => setGrounds(g)).catch(() => {}),
      api.listUsers().then((u: UserItem[]) => setAllUsers(u)).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    if (sports.length > 0 && !sports.find(s => s.key === sportType)) {
      setSportType(sports[0].key);
      if (sportDefaults[sports[0].key]) setMaxPlayers(String(sportDefaults[sports[0].key]));
      if (SPORT_DURATIONS[sports[0].key]) setDurationMinutes(String(SPORT_DURATIONS[sports[0].key]));
    }
  }, [sports, sportType, sportDefaults]);

  const handleSportChange = (val: string) => {
    setSportType(val);
    if (sportDefaults[val]) setMaxPlayers(String(sportDefaults[val]));
    if (SPORT_DURATIONS[val]) setDurationMinutes(String(SPORT_DURATIONS[val]));
  };

  const updateRecurrenceDay = (index: number, field: 'day' | 'time', value: string) => {
    const updated = [...recurrenceDays];
    updated[index][field] = value;
    setRecurrenceDays(updated);
  };

  const addRecurrenceDay = () => {
    setRecurrenceDays([...recurrenceDays, { day: 'Wednesday', time: '20:00' }]);
  };

  const removeRecurrenceDay = (index: number) => {
    setRecurrenceDays(recurrenceDays.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);

    const finalGround = groundName === '__other__' ? customGround : groundName;
    if (!seriesName.trim() || !finalGround.trim()) {
      setError('Series name and ground are required');
      setLoading(false);
      return;
    }
    if (!groundCost || isNaN(Number(groundCost))) {
      setError('Please enter a valid ground cost');
      setLoading(false);
      return;
    }
    if (recurrenceDays.length === 0) {
      setError('Add at least one recurrence day');
      setLoading(false);
      return;
    }

    try {
      const res = await api.createSeries({
        series_name: seriesName,
        sport_type: sportType,
        ground_name: finalGround,
        max_players: parseInt(maxPlayers),
        ground_cost: parseFloat(groundCost) || 0,
        duration_minutes: parseInt(durationMinutes) || 90,
        payee_user_id: payeeUserId ? Number(payeeUserId) : undefined,
        quit_penalty_hours: parseInt(quitPenaltyHours) || 0,
        payment_mode: paymentMode,
        potd_congrats_delay_minutes: parseInt(potdDelayMinutes) || 1440,
        recurrence_days: recurrenceDays,
        weeks: parseInt(weeks) || 4,
        start_date: startDate || undefined,
      });
      setResult({ created: res.created?.length || 0, skipped: res.skipped?.length || 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create series');
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
          <h1 className="text-xl font-bold">Create Game Series</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Recurring Game Series</CardTitle></CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-4 text-center">
                <p className="text-green-700 font-medium">Series created successfully!</p>
                <p className="text-sm text-gray-600">Created {result.created} game(s). Skipped {result.skipped} slot(s).</p>
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={onBack}>Done</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}
                <div className="space-y-2">
                  <Label>Series Name</Label>
                  <Input placeholder="e.g. Bangalore - Whitefield United" value={seriesName} onChange={(e) => setSeriesName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Sport Type</Label>
                  <Select value={sportType} onValueChange={handleSportChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sports.map(s => (
                        <SelectItem key={s.key} value={s.key}>{s.icon} {s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ground / Venue</Label>
                  <Select value={groundName} onValueChange={(val) => { setGroundName(val); if (val !== '__other__') setCustomGround(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select a ground" /></SelectTrigger>
                    <SelectContent>
                      {grounds.map(g => (
                        <SelectItem key={g.id} value={g.display_name}>{g.display_name}</SelectItem>
                      ))}
                      <SelectItem value="__other__">Other (Type below)</SelectItem>
                    </SelectContent>
                  </Select>
                  {groundName === '__other__' && (
                    <Input placeholder="Enter ground name" value={customGround} onChange={(e) => setCustomGround(e.target.value)} required />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Max Players</Label>
                    <Input type="number" min="2" max={sportDefaults[sportType] || 100} value={maxPlayers} onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const cap = sportDefaults[sportType] || 100;
                      setMaxPlayers(String(Math.min(Math.max(val, 2), cap)));
                    }} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Ground Cost ({currency})</Label>
                    <Input type="number" min="0" step="0.01" value={groundCost} onChange={(e) => setGroundCost(e.target.value)} required />
                  </div>
                </div>
                {costPerPerson && (
                  <div className="p-2 bg-green-50 rounded text-sm text-green-800">
                    Cost per player: <span className="font-semibold">{costPerPerson} {currency}</span> (read-only)
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Duration (minutes)</Label>
                    <Input type="number" min="15" max="600" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
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
                <div className="space-y-2">
                  <Label>POTD Congratulation Delay (minutes)</Label>
                  <Input type="number" min="1" max="10080" value={potdDelayMinutes} onChange={(e) => setPotdDelayMinutes(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Payment Receiver</Label>
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
                    <Label>Quit Penalty (hours)</Label>
                    <Input type="number" min="0" max="72" value={quitPenaltyHours} onChange={(e) => setQuitPenaltyHours(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Weeks to Create</Label>
                    <Input type="number" min="1" max="52" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Start From (first game on or after this date)</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Recurrence Days</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addRecurrenceDay} className="flex items-center gap-1">
                      <Plus size={14} /> Add Day
                    </Button>
                  </div>
                  {recurrenceDays.map((rd, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select value={rd.day} onValueChange={(v) => updateRecurrenceDay(idx, 'day', v)}>
                        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="time" value={rd.time} onChange={(e) => updateRecurrenceDay(idx, 'time', e.target.value)} className="w-32" />
                      {recurrenceDays.length > 1 && (
                        <button type="button" onClick={() => removeRecurrenceDay(idx)} className="text-red-500 hover:text-red-700 p-2">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Series'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
