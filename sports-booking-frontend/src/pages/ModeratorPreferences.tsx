import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings, DollarSign, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ALL_SPORTS } from '../lib/sports';

interface Props {
  onBack: () => void;
}

export default function ModeratorPreferences({ onBack }: Props) {
  const { appSettings, refreshAppSettings, isAdmin } = useAuth();
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

  const toggleSportEnabled = async (sportKey: string) => {
    if (!isAdmin || !appSettings) return;
    const current = new Set(appSettings.enabled_sports || []);
    if (current.has(sportKey)) current.delete(sportKey);
    else current.add(sportKey);
    setSaving('sports');
    try {
      await api.updateAppSettings({ enabled_sports: Array.from(current) });
      await refreshAppSettings();
      setSuccess('sports');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving('');
    }
  };

  const handleTogglePayments = async () => {
    if (!isAdmin || !appSettings) return;
    setSaving('payments');
    try {
      await api.updateAppSettings({ payments_enabled: !appSettings.payments_enabled, payment_surcharge_percent: appSettings.payment_surcharge_percent });
      await refreshAppSettings();
      setSuccess('payments');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving('');
    }
  };

  const handleSurchargeChange = async (value: string) => {
    if (!isAdmin || !appSettings) return;
    const pct = parseFloat(value);
    if (isNaN(pct)) return;
    setSaving('payments');
    try {
      await api.updateAppSettings({ payments_enabled: appSettings.payments_enabled, payment_surcharge_percent: pct });
      await refreshAppSettings();
      setSuccess('payments');
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
            <Settings size={20} /> Admin & Moderator Preferences
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

        {isAdmin && appSettings && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Trophy size={18} /> Enabled Sports</CardTitle>
              <p className="text-sm text-gray-500">Only enabled sports appear when creating games or filling profiles.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {success === 'sports' && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">Sports settings saved!</div>}
              <div className="grid grid-cols-2 gap-3">
                {ALL_SPORTS.map(sport => {
                  const enabled = appSettings.enabled_sports?.includes(sport.key);
                  return (
                    <button
                      key={sport.key}
                      type="button"
                      disabled={saving === 'sports'}
                      onClick={() => toggleSportEnabled(sport.key)}
                      className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                        enabled
                          ? 'bg-green-50 border-green-500 text-green-700'
                          : 'bg-gray-50 border-gray-200 text-gray-400'
                      }`}
                    >
                      <span className="text-xl">{sport.icon}</span>
                      <span className="text-sm font-medium">{sport.label}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && appSettings && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><DollarSign size={18} /> Payments</CardTitle>
              <p className="text-sm text-gray-500">Toggle in-app payments and surcharge.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {success === 'payments' && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">Payment settings saved!</div>}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={appSettings.payments_enabled}
                  onChange={handleTogglePayments}
                  disabled={saving === 'payments'}
                  className="rounded border-gray-300"
                />
                In-App Payments Enabled
              </label>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Payment Surcharge (%)</label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={appSettings.payment_surcharge_percent}
                  onChange={(e) => handleSurchargeChange(e.target.value)}
                  disabled={saving === 'payments'}
                  className="w-full"
                />
              </div>
              <p className="text-xs text-gray-500">
                When disabled, players cannot pay through the app and moderators mark payments offline. When enabled, costs include the surcharge.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
