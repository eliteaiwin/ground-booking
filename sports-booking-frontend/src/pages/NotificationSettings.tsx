import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Bell, BellOff, Palmtree, MapPin, Shield, Volume2, VolumeX } from 'lucide-react';

interface NotifSettings {
  voting_started: boolean;
  game_cancelled: boolean;
  game_completed_vote: boolean;
  potd_announced: boolean;
  potd_congrats_delay_hours: number;
  vacation_start: string | null;
  vacation_end: string | null;
  is_on_vacation: boolean;
}

interface GroundPause {
  id: number;
  ground_id: number;
  ground_name: string;
  sport_type: string;
  paused: boolean;
}

interface GroundInfo {
  id: number;
  name: string;
  location: string;
  display_name: string;
  sport_types: string[];
}

const sportIconChar = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
};

interface Props {
  onBack: () => void;
}

export default function NotificationSettings({ onBack }: Props) {
  const { isModerator, isAdmin, activeRole } = useAuth();
  const isUserRole = activeRole === 'user';
  const [settings, setSettings] = useState<NotifSettings | null>(null);
  const [pauses, setPauses] = useState<GroundPause[]>([]);
  const [grounds, setGrounds] = useState<GroundInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vacStart, setVacStart] = useState('');
  const [vacEnd, setVacEnd] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, p, g] = await Promise.all([
        api.getNotificationSettings(),
        api.getGroundAlertPauses(),
        api.getMyGroundsForNotifications(),
      ]);
      setSettings(s);
      setPauses(p);
      setGrounds(g);
      setVacStart(s.vacation_start || '');
      setVacEnd(s.vacation_end || '');
    } catch (err) {
      console.error('Failed to load notification settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSetting = async (key: string, value: boolean) => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.updateNotificationSettings({ [key]: value });
      setSettings({ ...settings, [key]: value });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const saveVacation = async () => {
    setSaving(true);
    try {
      await api.updateNotificationSettings({
        vacation_start: vacStart || '',
        vacation_end: vacEnd || '',
      });
      const s = await api.getNotificationSettings();
      setSettings(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const clearVacation = async () => {
    setSaving(true);
    try {
      await api.updateNotificationSettings({ vacation_start: '', vacation_end: '' });
      setVacStart('');
      setVacEnd('');
      const s = await api.getNotificationSettings();
      setSettings(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };


  const toggleGroundPause = async (groundId: number, sportType: string, currentlyPaused: boolean) => {
    try {
      if (currentlyPaused) {
        // Find the pause to remove
        const pause = pauses.find(p => p.ground_id === groundId && p.sport_type === sportType && p.paused);
        if (pause) {
          await api.removeGroundAlertPause(pause.id);
        }
      } else {
        await api.setGroundAlertPause(groundId, sportType, true);
      }
      const p = await api.getGroundAlertPauses();
      setPauses(p);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const isGroundPaused = (groundId: number, sportType: string) => {
    return pauses.some(p => p.ground_id === groundId && (p.sport_type === sportType || p.sport_type === '') && p.paused);
  };

  const getSettingValue = (key: string): boolean => {
    if (!settings) return true;
    switch (key) {
      case 'voting_started': return settings.voting_started;
      case 'game_cancelled': return settings.game_cancelled;
      case 'game_completed_vote': return settings.game_completed_vote;
      case 'potd_announced': return settings.potd_announced;
      default: return true;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading notification settings...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-600 text-white shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell size={20} /> Notification Settings
          </h1>
          <p className="text-sm text-indigo-200 mt-1">Manage your alerts and notification preferences</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Vacation Mode - User role only */}
        {isUserRole && (<Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Palmtree size={18} className="text-green-600" /> Vacation Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {settings?.is_on_vacation && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-700 font-medium flex items-center gap-1">
                  <BellOff size={14} /> You are on vacation - all alerts paused
                </p>
              </div>
            )}
            <p className="text-xs text-gray-500">During vacation, you won't receive any game alerts (voting, cancellation, POTD). Moderator-controlled alerts (payment reminders) are not affected.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={vacStart} onChange={e => setVacStart(e.target.value)} className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={vacEnd} onChange={e => setVacEnd(e.target.value)} className="text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={saveVacation} disabled={saving || !vacStart || !vacEnd}>
                {settings?.is_on_vacation ? 'Update Vacation' : 'Set Vacation'}
              </Button>
              {(settings?.vacation_start || vacStart) && (
                <Button size="sm" variant="outline" onClick={clearVacation} disabled={saving}>
                  Clear Vacation
                </Button>
              )}
            </div>
          </CardContent>
        </Card>)}

        {/* Alert Toggles */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Volume2 size={18} className="text-blue-600" /> Alert Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">Enable or disable specific notification types. These apply to all grounds where you haven't paused alerts.</p>
            {settings && (
              <div className="space-y-2">
                {[
                  { key: 'voting_started', label: 'When Voting Starts', desc: 'Get notified when a game opens for voting' },
                  { key: 'game_cancelled', label: 'When Game is Cancelled', desc: 'Get notified when a game you joined is cancelled' },
                  { key: 'game_completed_vote', label: 'Vote for Player of the Day', desc: 'Reminder to vote for POTD after game completes' },
                  { key: 'potd_announced', label: 'Player of the Day Announced', desc: 'Get notified when POTD winner is announced' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => toggleSetting(item.key, !getSettingValue(item.key))}
                      disabled={saving}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        getSettingValue(item.key) ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        getSettingValue(item.key) ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            )}

          </CardContent>
        </Card>

        {/* Ground-level Alert Pauses - User role only */}
        {isUserRole && (<Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin size={18} className="text-orange-600" /> Ground Alert Pauses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">Pause or resume alerts for specific grounds and sports. Paused grounds won't send you any user-controlled notifications.</p>
            {grounds.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No grounds found. Join a ground to manage alerts.</p>
            ) : (
              grounds.map(ground => (
                <div key={ground.id} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={14} className="text-green-600" />
                    <p className="text-sm font-medium">{ground.display_name}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* All sports toggle */}
                    <button
                      onClick={() => toggleGroundPause(ground.id, '', isGroundPaused(ground.id, ''))}
                      className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        isGroundPaused(ground.id, '')
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-green-50 border-green-300 text-green-700'
                      }`}
                    >
                      {isGroundPaused(ground.id, '') ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      All Sports
                    </button>
                    {/* Per-sport toggles */}
                    {ground.sport_types.map(sport => (
                      <button
                        key={sport}
                        onClick={() => toggleGroundPause(ground.id, sport, isGroundPaused(ground.id, sport))}
                        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          isGroundPaused(ground.id, sport)
                            ? 'bg-red-50 border-red-300 text-red-700'
                            : 'bg-green-50 border-green-300 text-green-700'
                        }`}
                      >
                        {isGroundPaused(ground.id, sport) ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        {sportIconChar(sport)} {sport.charAt(0).toUpperCase() + sport.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>)}

        {/* Moderator-controlled alerts info - Moderator only, not Admin */}
        {isModerator && !isAdmin && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield size={18} className="text-purple-600" /> Moderator Alert Controls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-500 mb-3">
                As a moderator, you can control payment-related alerts for users. These alerts cannot be disabled by the user themselves.
              </p>
              <div className="space-y-2">
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm font-medium text-purple-800">Payment Overdue Alert</p>
                  <p className="text-xs text-purple-600">Sent 10 minutes after game ends if payment not made</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm font-medium text-purple-800">Payment Reminder (Every 6 Hours)</p>
                  <p className="text-xs text-purple-600">Recurring reminder until payment is made. After 4th reminder, you (moderator) are alerted.</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm font-medium text-purple-800">Nomination Payment Alert</p>
                  <p className="text-xs text-purple-600">When a user is nominated by someone else, both get payment alerts</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">To configure these per-user, go to Ground Management and manage individual user alert settings.</p>
            </CardContent>
          </Card>
        )}

        {/* Active Pauses Summary - User role only */}
        {isUserRole && pauses.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-600">Active Pauses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {pauses.filter(p => p.paused).map(p => (
                  <Badge key={p.id} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                    <BellOff size={10} className="mr-1" />
                    {p.ground_name} {p.sport_type ? `(${p.sport_type})` : '(all sports)'}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
