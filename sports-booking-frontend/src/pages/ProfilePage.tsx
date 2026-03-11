import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, User, Phone, Mail, MapPin, MessageCircle, MessageSquare, ShieldCheck } from 'lucide-react';

const ALL_SPORTS = ['Soccer', 'Cricket', 'Badminton', 'Basketball', 'Hockey'];
const ALL_LOCATIONS = ['Bangalore', 'Chennai', 'Delhi', 'Gurgaon', 'Noida', 'Hyderabad', 'Cochin', 'Pune'];

const SPORT_POSITIONS: Record<string, string[]> = {
  Soccer: ['Goalkeeper', 'Right Back', 'Left Back', 'Center Back', 'Midfielder', 'Right Wing', 'Left Wing', 'Striker', 'Forward'],
  Cricket: ['Batsman', 'Bowler', 'All-Rounder', 'Wicket Keeper'],
  Badminton: ['Singles', 'Doubles'],
  Basketball: ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center'],
  Hockey: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
};

const CURRENCIES = [
  { value: 'Rs', label: 'Rs (Indian Rupee)' },
  { value: '$', label: '$ (US Dollar)' },
  { value: '€', label: '€ (Euro)' },
  { value: '£', label: '£ (British Pound)' },
  { value: '¥', label: '¥ (Japanese Yen)' },
  { value: 'A$', label: 'A$ (Australian Dollar)' },
  { value: 'C$', label: 'C$ (Canadian Dollar)' },
  { value: 'CHF', label: 'CHF (Swiss Franc)' },
  { value: 'AED', label: 'AED (UAE Dirham)' },
  { value: 'SGD', label: 'SGD (Singapore Dollar)' },
];

interface Props {
  onBack: () => void;
}

export default function ProfilePage({ onBack }: Props) {
  const { user, refreshUser, logout } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [notifPref, setNotifPref] = useState(user?.notification_preference || 'whatsapp');
  const [sports, setSports] = useState<string[]>(user?.sports || []);
  const [locations, setLocations] = useState<string[]>(user?.locations || []);
  const [sportPositions, setSportPositions] = useState<Record<string, string[]>>(user?.sport_positions || {});
  const [currency, setCurrency] = useState(user?.currency || 'Rs');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');

  const toggleSport = (sport: string) => {
    setSports(prev => {
      if (prev.includes(sport)) {
        const np = { ...sportPositions };
        delete np[sport];
        setSportPositions(np);
        return prev.filter(s => s !== sport);
      }
      return [...prev, sport];
    });
  };

  const toggleLocation = (loc: string) => {
    setLocations(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
  };

  const togglePosition = (sport: string, position: string) => {
    setSportPositions(prev => {
      const current = prev[sport] || [];
      const updated = current.includes(position)
        ? current.filter(p => p !== position)
        : [...current, position];
      return { ...prev, [sport]: updated };
    });
  };

  const handleVerifyPhone = () => {
    setVerifyMsg('Verification OTP sent! (Demo: auto-verified)');
    setTimeout(() => setVerifyMsg(''), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      const data: Record<string, unknown> = {};
      if (firstName !== user?.first_name) data.first_name = firstName;
      if (lastName !== user?.last_name) data.last_name = lastName;
      if (email !== user?.email) data.email = email;
      if (phone !== user?.phone) data.phone = phone;
      if (notifPref !== user?.notification_preference) data.notification_preference = notifPref;
      if (currency !== user?.currency) data.currency = currency;
      data.sports = sports;
      data.locations = locations;
      data.sport_positions = sportPositions;

      await api.updateProfile(data as Parameters<typeof api.updateProfile>[0]);
      await refreshUser();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">My Profile</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <User size={32} className="text-green-600" />
              </div>
              <div>
                <CardTitle className="text-lg">{user?.first_name} {user?.last_name}</CardTitle>
                <div className="flex gap-1 mt-1">
                  {user?.roles.map(role => (
                    <Badge key={role} variant="secondary" className="text-xs capitalize">{role}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-gray-500 text-sm"><Phone size={14} /> {user?.phone}
              {user?.phone_verified ? (
                <Badge className="bg-green-100 text-green-700 text-xs"><ShieldCheck size={10} className="mr-1" />Verified</Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-orange-600">Not Verified</Badge>
              )}
            </div>
            {user?.email && <div className="flex items-center gap-2 text-gray-500 text-sm"><Mail size={14} /> {user?.email}</div>}
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              {user?.notification_preference === 'whatsapp' ? (
                <MessageCircle size={14} className="text-green-500" />
              ) : (
                <MessageSquare size={14} className="text-blue-500" />
              )}
              <span>Notifications via {user?.notification_preference === 'sms' ? 'SMS' : 'WhatsApp'}</span>
              {user?.notification_preference === 'whatsapp' ? (
                <span className="text-green-500 text-xs">(WhatsApp)</span>
              ) : (
                <span className="text-blue-500 text-xs">(SMS)</span>
              )}
            </div>
            {user?.currency && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <span className="font-medium">Currency:</span> {user.currency}
              </div>
            )}
            {user?.sports && user.sports.length > 0 && (
              <div className="flex items-center gap-2 text-gray-500 text-sm flex-wrap">
                <span className="font-medium">Sports:</span>
                {user.sports.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
              </div>
            )}
            {user?.sport_positions && Object.keys(user.sport_positions).length > 0 && (
              <div className="text-gray-500 text-sm">
                <span className="font-medium">Positions:</span>
                {Object.entries(user.sport_positions).map(([sport, positions]) => (
                  positions.length > 0 && (
                    <div key={sport} className="ml-4 mt-1">
                      <span className="text-xs font-medium">{sport}:</span>{' '}
                      {positions.map(p => <Badge key={p} variant="outline" className="text-xs ml-1">{p}</Badge>)}
                    </div>
                  )
                ))}
              </div>
            )}
            {user?.locations && user.locations.length > 0 && (
              <div className="flex items-center gap-2 text-gray-500 text-sm flex-wrap">
                <MapPin size={14} />
                <span className="font-medium">Your Location:</span>
                {user.locations.map(l => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Edit Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {success && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">Profile updated!</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="prof-fn">First Name</Label>
                <Input id="prof-fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prof-ln">Last Name</Label>
                <Input id="prof-ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prof-email">Email</Label>
              <Input id="prof-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prof-phone">Mobile Number</Label>
              <div className="flex gap-2">
                <Input id="prof-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="flex-1" />
                <Button type="button" size="sm" variant="outline" onClick={handleVerifyPhone}
                  className="text-green-600 border-green-300 hover:bg-green-50 shrink-0">
                  <ShieldCheck size={14} className="mr-1" /> Verify
                </Button>
              </div>
              {verifyMsg && <p className="text-xs text-green-600">{verifyMsg}</p>}
            </div>
            <div className="space-y-2">
              <Label>Communication Preference</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPref === 'whatsapp'} onCheckedChange={() => setNotifPref('whatsapp')} />
                  <MessageCircle size={14} className="text-green-500" />
                  <span className="text-sm">WhatsApp</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPref === 'sms'} onCheckedChange={() => setNotifPref('sms')} />
                  <MessageSquare size={14} className="text-blue-500" />
                  <span className="text-sm">SMS</span>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Your Location</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_LOCATIONS.map(loc => (
                  <button key={loc} type="button" onClick={() => toggleLocation(loc)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      locations.includes(loc)
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                    }`}>{loc}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Preferred Sports</Label>
              <div className="flex flex-wrap gap-3">
                {ALL_SPORTS.map(sport => (
                  <label key={sport} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={sports.includes(sport)} onCheckedChange={() => toggleSport(sport)} />
                    <span className="text-sm">{sport}</span>
                  </label>
                ))}
              </div>
            </div>
            {sports.length > 0 && (
              <div className="space-y-3">
                <Label>Preferred Positions</Label>
                {sports.map(sport => (
                  <div key={sport} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">{sport}</p>
                    <div className="flex flex-wrap gap-2">
                      {(SPORT_POSITIONS[sport] || []).map(pos => (
                        <button key={pos} type="button" onClick={() => togglePosition(sport, pos)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            (sportPositions[sport] || []).includes(pos)
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                          }`}>{pos}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label>Default Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-green-600 hover:bg-green-700" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>
        <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50" onClick={logout}>Logout</Button>
      </div>
    </div>
  );
}
