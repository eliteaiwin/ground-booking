import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { User, Phone, Mail, MapPin, Trophy, Camera } from 'lucide-react';
import { useSports } from '../lib/sports';


const ALL_LOCATIONS = ['Bangalore', 'Chennai', 'Delhi', 'Gurgaon', 'Noida', 'Hyderabad', 'Cochin', 'Pune'];

interface Props {
  onComplete: () => void;
}

export default function OnboardingProfile({ onComplete }: Props) {
  const { user, refreshUser } = useAuth();
  const enabledSports = useSports();
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [sports, setSports] = useState<string[]>(user?.sports || []);
  const [locations, setLocations] = useState<string[]>(user?.locations || []);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profilePic, setProfilePic] = useState(user?.profile_pic || '');
  const [uploadingPic, setUploadingPic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      // Normalize stored sports to enabled sport keys
      const normalized = (user.sports || []).map(us => {
        const match = enabledSports.find(s => s.key.toLowerCase() === us.toLowerCase());
        return match ? match.key : us;
      });
      setSports(normalized);
      setLocations(user.locations || []);
      setProfilePic(user.profile_pic || '');
    }
  }, [user, enabledSports]);

  const isSportSelected = (sportKey: string) => sports.some(s => s.toLowerCase() === sportKey.toLowerCase());

  const toggleSport = (sportKey: string) => {
    setSports(prev => {
      const existing = prev.find(s => s.toLowerCase() === sportKey.toLowerCase());
      if (existing) return prev.filter(s => s.toLowerCase() !== sportKey.toLowerCase());
      return [...prev, sportKey];
    });
  };

  const toggleLocation = (loc: string) => {
    setLocations(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
  };

  const handleProfilePicChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPic(true);
    setError('');
    try {
      const res = await api.uploadProfilePic(file);
      setProfilePic(res.filename);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload profile picture');
    } finally {
      setUploadingPic(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim()) return setError('First name is required');
    if (!phone.trim()) return setError('Phone number is required');
    if (sports.length === 0) return setError('Select at least one sport');
    if (locations.length === 0) return setError('Select at least one location');
    if (!newPassword.trim()) return setError('Please set a new password to continue');
    if (newPassword.length < 6) return setError('Password must be at least 6 characters');
    if (newPassword !== confirmPassword) return setError('Passwords do not match');

    setSaving(true);
    try {
      if (newPassword) {
        await api.changePassword({ new_password: newPassword });
      }
      await api.updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim(),
        sports,
        locations,
      });
      localStorage.removeItem('force_password_change');
      await refreshUser();
      onComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="max-w-lg mx-auto py-8">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-white rounded-2xl shadow-lg mx-auto mb-4 flex items-center justify-center overflow-hidden">
            <img src="/turf-icon.png" alt="Elite Turf Booking" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Complete Your Profile</h1>
          <p className="text-sm text-gray-500">Tell us a little about yourself to get started.</p>
        </div>

        <Card>
          <form onSubmit={handleSave}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User size={18} className="text-green-600" /> Personal Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}

              <div className="flex flex-col items-center gap-2">
                <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center border-2 border-green-200">
                  {profilePic ? (
                    <img src={api.getProfilePicUrl(profilePic)} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User size={40} className="text-gray-400" />
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleProfilePicChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPic}
                  className="flex items-center gap-2"
                >
                  <Camera size={14} /> {uploadingPic ? 'Uploading...' : 'Upload Photo'}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="fn">First Name</Label>
                  <Input id="fn" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ln">Last Name</Label>
                  <Input id="ln" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="flex items-center gap-1"><Mail size={14} /> Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="phone" className="flex items-center gap-1"><Phone size={14} /> Mobile Number</Label>
                <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} required />
              </div>

              <div className="space-y-1">
                <Label className="flex items-center gap-1"><Trophy size={14} /> Sports</Label>
                <div className="flex flex-wrap gap-2">
                  {enabledSports.map(sport => (
                    <button
                      key={sport.key}
                      type="button"
                      onClick={() => toggleSport(sport.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        isSportSelected(sport.key)
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                      }`}
                    >{sport.icon} {sport.label}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="flex items-center gap-1"><MapPin size={14} /> Locations</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_LOCATIONS.map(loc => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => toggleLocation(loc)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        locations.includes(loc)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                      }`}
                    >{loc}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="np">New Password</Label>
                  <Input id="np" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 chars" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cp">Confirm Password</Label>
                  <Input id="cp" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              {newPassword && newPassword.length < 6 && (
                <p className="text-xs text-orange-600">Password must be at least 6 characters</p>
              )}

              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={saving}>
                {saving ? 'Saving...' : 'Save & Continue'}
              </Button>
            </CardContent>
          </form>
        </Card>
      </div>
    </div>
  );
}
