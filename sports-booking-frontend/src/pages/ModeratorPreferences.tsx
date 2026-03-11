import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings } from 'lucide-react';

const ALL_SPORTS = [
  { key: 'soccer', label: 'Soccer', icon: '\u26BD', defaultPlayers: 16 },
  { key: 'cricket', label: 'Cricket', icon: '\uD83C\uDFCF', defaultPlayers: 14 },
  { key: 'badminton', label: 'Badminton', icon: '\uD83C\uDFF8', defaultPlayers: 4 },
  { key: 'basketball', label: 'Basketball', icon: '\uD83C\uDFC0', defaultPlayers: 10 },
  { key: 'hockey', label: 'Hockey', icon: '\uD83C\uDFD2', defaultPlayers: 14 },
];

interface Props {
  onBack: () => void;
}

export default function ModeratorPreferences({ onBack }: Props) {
  const [prefs, setPrefs] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    try {
      const data = await api.getPreferences();
      const map: Record<string, number> = {};
      data.forEach((p: { sport_type: string; default_max_players: number }) => {
        map[p.sport_type] = p.default_max_players;
      });
      // Fill defaults for any missing sports
      ALL_SPORTS.forEach(s => {
        if (!map[s.key]) map[s.key] = s.defaultPlayers;
      });
      setPrefs(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (sportKey: string) => {
    setSaving(sportKey);
    try {
      await api.updatePreference(sportKey, prefs[sportKey] || 10);
      setSuccess(sportKey);
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving('');
    }
  };

  const handleSaveAll = async () => {
    setSaving('all');
    try {
      for (const sport of ALL_SPORTS) {
        await api.updatePreference(sport.key, prefs[sport.key] || sport.defaultPlayers);
      }
      setSuccess('all');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Settings size={20} /> Moderator Preferences
          </h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Default Player Count per Sport</CardTitle>
            <p className="text-sm text-gray-500">Set the default number of players for each sport. This will auto-fill when creating new games.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {success === 'all' && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">All preferences saved!</div>}
            {ALL_SPORTS.map(sport => (
              <div key={sport.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-2xl">{sport.icon}</span>
                <div className="flex-1">
                  <Label className="text-sm font-medium">{sport.label}</Label>
                  <Input
                    type="number"
                    min="2"
                    max="100"
                    value={prefs[sport.key] || sport.defaultPlayers}
                    onChange={(e) => setPrefs(prev => ({ ...prev, [sport.key]: parseInt(e.target.value) || 0 }))}
                    className="mt-1"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSave(sport.key)}
                  disabled={saving === sport.key}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {saving === sport.key ? '...' : success === sport.key ? 'Saved!' : 'Save'}
                </Button>
              </div>
            ))}
            <Button onClick={handleSaveAll} className="w-full bg-green-600 hover:bg-green-700" disabled={saving === 'all'}>
              {saving === 'all' ? 'Saving All...' : 'Save All Preferences'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
