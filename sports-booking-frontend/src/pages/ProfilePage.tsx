import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, User, Phone, Mail, MapPin, MessageCircle, MessageSquare, ShieldCheck, Camera, Trophy, Target, Award, Plus, X, Trash2, ImageIcon } from 'lucide-react';

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
  { value: '₹', label: '₹ (Indian Rupee)' },
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

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'GMT +5:30 (IST - India)' },
  { value: 'America/New_York', label: 'GMT -5:00 (EST - US East)' },
  { value: 'America/Chicago', label: 'GMT -6:00 (CST - US Central)' },
  { value: 'America/Denver', label: 'GMT -7:00 (MST - US Mountain)' },
  { value: 'America/Los_Angeles', label: 'GMT -8:00 (PST - US West)' },
  { value: 'Europe/London', label: 'GMT +0:00 (GMT - UK)' },
  { value: 'Europe/Paris', label: 'GMT +1:00 (CET - Europe)' },
  { value: 'Asia/Dubai', label: 'GMT +4:00 (GST - UAE)' },
  { value: 'Asia/Singapore', label: 'GMT +8:00 (SGT - Singapore)' },
  { value: 'Australia/Sydney', label: 'GMT +11:00 (AEDT - Australia)' },
  { value: 'Pacific/Auckland', label: 'GMT +13:00 (NZDT - New Zealand)' },
  { value: 'Asia/Tokyo', label: 'GMT +9:00 (JST - Japan)' },
  { value: 'Asia/Hong_Kong', label: 'GMT +8:00 (HKT - Hong Kong)' },
];

interface Props {
  onBack: () => void;
}

interface UserPhoto {
  id: number;
  filename: string;
  purpose: string;
  caption: string;
  created_at: string;
}

interface PersonaData {
  id: number;
  user_code: string;
  first_name: string;
  last_name: string;
  name: string;
  profile_pic: string;
  sport_rankings: { sport: string; points: number; rank: number; games_played: number }[];
  goal_stats: { sport: string; total_goals: number }[];
  grounds_played: { ground_id: number; ground_name: string; location: string }[];
  total_games_played: number;
}

export default function ProfilePage({ onBack }: Props) {
  const { user, refreshUser, logout } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const initNotifPrefs = (user?.notification_preference || 'whatsapp').split(',').filter(Boolean);
  const [notifPrefs, setNotifPrefs] = useState<string[]>(initNotifPrefs);
  const [sports, setSports] = useState<string[]>(user?.sports || []);
  const [locations, setLocations] = useState<string[]>(user?.locations || []);
  const [sportPositions, setSportPositions] = useState<Record<string, string[]>>(user?.sport_positions || {});
  const [currency, setCurrency] = useState(user?.currency || '₹');
  const [timezone, setTimezone] = useState(user?.timezone || 'Asia/Kolkata');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [uploadingPic, setUploadingPic] = useState(false);
  const [profilePic, setProfilePic] = useState(user?.profile_pic || '');
  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [showPersona, setShowPersona] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userPhotos, setUserPhotos] = useState<UserPhoto[]>([]);
  const [uploadPurpose, setUploadPurpose] = useState('profile');
  const [uploadingMulti, setUploadingMulti] = useState(false);
  const multiFileRef = useRef<HTMLInputElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadUserPhotos = async () => {
    try {
      const data = await api.listUserPhotos();
      setUserPhotos(data.photos || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadUserPhotos();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUploadPic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Only image files allowed'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Max 5MB file size'); return; }
    setUploadingPic(true);
    try {
      const result = await api.uploadProfilePic(file);
      setProfilePic(result.filename);
      await refreshUser();
      await loadUserPhotos();
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingPic(false);
    }
  };

  const handleUploadMultiPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Only image files allowed'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Max 5MB file size'); return; }
    setUploadingMulti(true);
    try {
      await api.uploadUserPhoto(file, uploadPurpose);
      await loadUserPhotos();
      if (uploadPurpose === 'profile') {
        await refreshUser();
        const profilePhoto = (await api.listUserPhotos()).photos?.find((p: UserPhoto) => p.purpose === 'profile');
        if (profilePhoto) setProfilePic(profilePhoto.filename);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingMulti(false);
      if (multiFileRef.current) multiFileRef.current.value = '';
    }
  };

  const handleChangePurpose = async (photoId: number, newPurpose: string) => {
    try {
      await api.updatePhotoPurpose(photoId, newPurpose);
      await loadUserPhotos();
      if (newPurpose === 'profile') {
        await refreshUser();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!confirm('Delete this photo?')) return;
    try {
      await api.deleteUserPhoto(photoId);
      await loadUserPhotos();
      await refreshUser();
      setProfilePic(user?.profile_pic || '');
    } catch (err) {
      console.error(err);
    }
  };

  const loadPersona = async () => {
    if (!user?.id) return;
    try {
      const data = await api.getUserPersona(user.id);
      setPersona(data);
      setShowPersona(true);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleNotifPref = (pref: string) => {
    setNotifPrefs(prev => {
      if (prev.includes(pref)) {
        if (prev.length === 1) return prev;
        return prev.filter(p => p !== pref);
      }
      return [...prev, pref];
    });
  };

  const addSport = (sport: string) => {
    if (!sports.includes(sport)) {
      setSports(prev => [...prev, sport]);
    }
  };

  const removeSport = (sport: string) => {
    if (sports.length <= 1) return;
    setSports(prev => prev.filter(s => s !== sport));
    setSportPositions(prev => {
      const np = { ...prev };
      delete np[sport];
      return np;
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
      const notifPrefStr = notifPrefs.join(',');
      if (notifPrefStr !== user?.notification_preference) data.notification_preference = notifPrefStr;
      if (currency !== user?.currency) data.currency = currency;
      if (timezone !== user?.timezone) data.timezone = timezone;
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

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteAccountAuth();
      logout();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
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
              <div className="relative">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center overflow-hidden">
                  {profilePic ? (
                    <img src={api.getProfilePicUrl(profilePic)} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User size={32} className="text-green-600" />
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 bg-green-600 rounded-full flex items-center justify-center text-white shadow-md hover:bg-green-700"
                  disabled={uploadingPic}
                >
                  <Camera size={14} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadPic} />
              </div>
              <div>
                <CardTitle className="text-lg">{user?.first_name} {user?.last_name}</CardTitle>
                {user?.user_code && (
                  <p className="text-xs text-gray-500 font-mono">{user.user_code}</p>
                )}
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
              {(user?.notification_preference || '').includes('whatsapp') && (
                <><MessageCircle size={14} className="text-green-500" /><span className="text-green-600 text-xs">WhatsApp</span></>
              )}
              {(user?.notification_preference || '').includes('sms') && (
                <><MessageSquare size={14} className="text-blue-500" /><span className="text-blue-600 text-xs">SMS</span></>
              )}
              <span>Notifications</span>
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
              <p className="text-xs text-gray-400">Select one or both</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPrefs.includes('whatsapp')} onCheckedChange={() => toggleNotifPref('whatsapp')} />
                  <MessageCircle size={14} className="text-green-500" />
                  <span className="text-sm">WhatsApp</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPrefs.includes('sms')} onCheckedChange={() => toggleNotifPref('sms')} />
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
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Sports &amp; Positions</Label>
                <span className="text-xs text-gray-400">Min. 1 sport required</span>
              </div>

              {/* Selected sports with positions */}
              {sports.map(sport => (
                <div key={sport} className="border border-green-200 bg-green-50/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-green-800">{sport}</span>
                    <button
                      type="button"
                      onClick={() => removeSport(sport)}
                      disabled={sports.length <= 1}
                      className={`p-1 rounded-full transition-colors ${
                        sports.length <= 1
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-red-400 hover:bg-red-50 hover:text-red-600'
                      }`}
                      title={sports.length <= 1 ? 'At least 1 sport required' : `Remove ${sport}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">Select your positions:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(SPORT_POSITIONS[sport] || []).map(pos => (
                      <button key={pos} type="button" onClick={() => togglePosition(sport, pos)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          (sportPositions[sport] || []).includes(pos)
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                        }`}>{pos}</button>
                    ))}
                  </div>
                  {(sportPositions[sport] || []).length > 0 && (
                    <p className="text-xs text-green-700 mt-2">
                      Selected: {(sportPositions[sport] || []).join(', ')}
                    </p>
                  )}
                </div>
              ))}

              {/* Add sport dropdown */}
              {ALL_SPORTS.filter(s => !sports.includes(s)).length > 0 && (
                <div className="border border-dashed border-gray-300 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">Add a sport:</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_SPORTS.filter(s => !sports.includes(s)).map(sport => (
                      <button key={sport} type="button" onClick={() => addSport(sport)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-300 bg-white text-gray-600 hover:border-green-400 hover:bg-green-50 transition-all">
                        <Plus size={12} /> {sport}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-green-600 hover:bg-green-700" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>
        {/* My Photos - Sport-Specific */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon size={18} className="text-blue-500" /> My Photos
            </CardTitle>
            <p className="text-xs text-gray-500">Upload photos for your profile and different sports. Sport-specific photos show in player lists.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload new photo */}
            <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Label className="text-sm mb-1 block">Upload for:</Label>
                  <Select value={uploadPurpose} onValueChange={setUploadPurpose}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="profile">Profile (Default)</SelectItem>
                      <SelectItem value="soccer">Soccer</SelectItem>
                      <SelectItem value="cricket">Cricket</SelectItem>
                      <SelectItem value="badminton">Badminton</SelectItem>
                      <SelectItem value="basketball">Basketball</SelectItem>
                      <SelectItem value="hockey">Hockey</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-5">
                  <Button
                    size="sm"
                    onClick={() => multiFileRef.current?.click()}
                    disabled={uploadingMulti}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Camera size={14} className="mr-1" />
                    {uploadingMulti ? 'Uploading...' : 'Upload'}
                  </Button>
                  <input ref={multiFileRef} type="file" accept="image/*" className="hidden" onChange={handleUploadMultiPhoto} />
                </div>
              </div>
              <p className="text-xs text-gray-400">Max 5MB per photo. One photo per purpose — uploading replaces the existing one.</p>
            </div>

            {/* Photo grid */}
            {userPhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {userPhotos.map(photo => (
                  <div key={photo.id || photo.filename} className="relative border rounded-lg overflow-hidden group">
                    <img
                      src={api.getProfilePicUrl(photo.filename)}
                      alt={photo.purpose}
                      className="w-full h-32 object-cover"
                    />
                    <div className="absolute top-1 left-1">
                      <Badge className={`text-xs capitalize ${
                        photo.purpose === 'profile' ? 'bg-green-600' :
                        photo.purpose === 'soccer' ? 'bg-blue-600' :
                        photo.purpose === 'cricket' ? 'bg-orange-600' :
                        photo.purpose === 'badminton' ? 'bg-purple-600' :
                        photo.purpose === 'basketball' ? 'bg-red-600' :
                        'bg-teal-600'
                      }`}>
                        {photo.purpose}
                      </Badge>
                    </div>
                    <div className="p-2 space-y-1">
                      <Select
                        value={photo.purpose}
                        onValueChange={(val) => {
                          if (photo.id > 0) handleChangePurpose(photo.id, val);
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="profile">Profile</SelectItem>
                          <SelectItem value="soccer">Soccer</SelectItem>
                          <SelectItem value="cricket">Cricket</SelectItem>
                          <SelectItem value="badminton">Badminton</SelectItem>
                          <SelectItem value="basketball">Basketball</SelectItem>
                          <SelectItem value="hockey">Hockey</SelectItem>
                        </SelectContent>
                      </Select>
                      {photo.id > 0 && (
                        <button
                          onClick={() => handleDeletePhoto(photo.id)}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 mt-1"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <ImageIcon size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No photos uploaded yet</p>
                <p className="text-xs">Upload a photo to get started</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Player Persona */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Award size={18} className="text-yellow-500" /> Player Persona
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!showPersona ? (
              <Button onClick={loadPersona} variant="outline" className="w-full">
                <Trophy size={14} className="mr-2" /> View My Persona
              </Button>
            ) : persona ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">Total Games: <span className="font-bold text-gray-800">{persona.total_games_played}</span></div>

                {persona.sport_rankings.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Trophy size={14} className="text-yellow-500" /> POTD Rankings</p>
                    <div className="space-y-1">
                      {persona.sport_rankings.map(r => (
                        <div key={r.sport} className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg">
                          <Badge className="bg-yellow-200 text-yellow-800 text-xs">Rank #{r.rank}</Badge>
                          <span className="text-sm font-medium capitalize">{r.sport}</span>
                          <span className="text-xs text-gray-500 ml-auto">{r.points} pts ({r.games_played} games)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {persona.goal_stats.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Target size={14} className="text-green-600" /> Goal Stats</p>
                    <div className="flex gap-2 flex-wrap">
                      {persona.goal_stats.map(g => (
                        <Badge key={g.sport} variant="outline" className="text-xs capitalize">
                          {g.sport}: {g.total_goals} goals
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {persona.grounds_played.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} className="text-blue-600" /> Grounds Played</p>
                    <div className="flex gap-2 flex-wrap">
                      {persona.grounds_played.map(g => (
                        <Badge key={g.ground_id} variant="outline" className="text-xs">
                          {g.location} - {g.ground_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Loading...</p>
            )}
          </CardContent>
        </Card>

        {/* Delete Account */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-600">
              <Trash2 size={18} /> Delete Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              Permanently delete your account and all associated data. Your data will be retained for 90 days — if you log back in within that period, your account will be restored. After 90 days, your phone number and email will be removed permanently.
            </p>
            {deleteError && <p className="text-red-500 text-sm">{deleteError}</p>}
            {!deleteConfirm ? (
              <Button
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => setDeleteConfirm(true)}
              >
                <Trash2 size={14} className="mr-2" /> Delete My Account
              </Button>
            ) : (
              <div className="space-y-3 bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="text-sm text-red-700 font-medium">
                  Are you sure? This action cannot be undone. All your data (games, payments, votes, photos) will be scheduled for permanent deletion.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setDeleteConfirm(false); setDeleteError(''); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    disabled={deleting}
                    onClick={handleDeleteAccount}
                  >
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50" onClick={logout}>Logout</Button>
      </div>
    </div>
  );
}
