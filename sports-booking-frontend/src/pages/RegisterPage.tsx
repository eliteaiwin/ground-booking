import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { X } from 'lucide-react';

const ALL_SPORTS = ['Soccer', 'Cricket', 'Badminton', 'Basketball', 'Hockey'];
const ALL_LOCATIONS = ['Bangalore', 'Chennai', 'Delhi', 'Gurgaon', 'Noida', 'Hyderabad', 'Cochin'];

const SPORT_POSITIONS: Record<string, string[]> = {
  Soccer: ['Goalkeeper', 'Right Back', 'Left Back', 'Center Back', 'Midfielder', 'Right Wing', 'Left Wing', 'Striker', 'Forward'],
  Cricket: ['Batsman', 'Bowler', 'All-Rounder', 'Wicket Keeper'],
  Badminton: ['Singles', 'Doubles'],
  Basketball: ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center'],
  Hockey: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
};

interface Props {
  onSwitchToLogin: () => void;
}

export default function RegisterPage({ onSwitchToLogin }: Props) {
  const { register } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notifPrefs, setNotifPrefs] = useState<string[]>(['whatsapp']);

  const toggleNotifPref = (pref: string) => {
    setNotifPrefs(prev => {
      if (prev.includes(pref)) {
        // Don't allow deselecting the last one
        if (prev.length === 1) return prev;
        return prev.filter(p => p !== pref);
      }
      return [...prev, pref];
    });
  };
  const [sports, setSports] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [sportPositions, setSportPositions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // OTP verification state
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDemo, setOtpDemo] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);

  const toggleSport = (sport: string) => {
    setSports(prev => {
      if (prev.includes(sport)) {
        const newPositions = { ...sportPositions };
        delete newPositions[sport];
        setSportPositions(newPositions);
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

  const handleSendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.requestRegistrationOTP({ phone });
      setOtpSent(true);
      setOtpStep(true);
      if (res.otp_demo) setOtpDemo(res.otp_demo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    setLoading(true);
    try {
      await api.verifyRegistrationOTP({ phone, otp: otpCode });
      setOtpVerified(true);
      setOtpStep(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate phone is filled before checking OTP
    if (!phone) {
      setError('Phone number is required');
      return;
    }

    // If phone not verified, send OTP first
    if (!otpVerified) {
      await handleSendOtp();
      return;
    }

    setLoading(true);
    try {
      await register({
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email || undefined,
        password,
        notification_preference: notifPrefs.join(','),
        sports,
        locations,
        sport_positions: sportPositions,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-screen overflow-y-auto relative">
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
          aria-label="Close"
        >
          <X size={20} />
        </button>
        <CardHeader className="text-center pb-3">
          <div className="mx-auto mb-3 w-14 h-14 bg-green-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xl">&#9917;</span>
          </div>
          <CardTitle className="text-2xl font-bold">Turf Booking</CardTitle>
          <p className="text-gray-500 mt-1">Create your account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-phone">Mobile Number</Label>
              <div className="flex gap-2">
                <Input
                  id="reg-phone"
                  type="tel"
                  placeholder="Your mobile number"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setOtpVerified(false); setOtpSent(false); setOtpStep(false); }}
                  required
                  disabled={otpVerified}
                  className="flex-1"
                />
                {otpVerified ? (
                  <span className="inline-flex items-center px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-md border border-green-200">Verified</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 border-green-300 text-green-600 hover:bg-green-50"
                    onClick={handleSendOtp}
                    disabled={loading || !phone}
                  >
                    {otpSent ? 'Resend' : 'Verify'}
                  </Button>
                )}
              </div>
            </div>

            {/* OTP Verification */}
            {otpStep && !otpVerified && (
              <div className="space-y-2 bg-blue-50 p-3 rounded-lg border border-blue-200">
                {otpDemo && (
                  <p className="text-sm text-blue-700">Demo OTP: <strong>{otpDemo}</strong></p>
                )}
                <Label htmlFor="reg-otp">Enter OTP</Label>
                <div className="flex gap-2">
                  <Input
                    id="reg-otp"
                    type="text"
                    placeholder="6-digit OTP"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    maxLength={6}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    className="shrink-0 bg-green-600 hover:bg-green-700"
                    onClick={handleVerifyOtp}
                    disabled={loading || otpCode.length < 6}
                  >
                    {loading ? 'Verifying...' : 'Verify OTP'}
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="reg-email">Email Address</Label>
              <Input id="reg-email" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-password">Password</Label>
              <Input id="reg-password" type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Communication Preference</Label>
              <p className="text-xs text-gray-400">Select one or both</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPrefs.includes('whatsapp')} onCheckedChange={() => toggleNotifPref('whatsapp')} />
                  <span className="text-sm">WhatsApp</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={notifPrefs.includes('sms')} onCheckedChange={() => toggleNotifPref('sms')} />
                  <span className="text-sm">SMS</span>
                </label>
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

            {/* Position Preferences per Sport */}
            {sports.length > 0 && (
              <div className="space-y-3">
                <Label>Preferred Positions</Label>
                {sports.map(sport => (
                  <div key={sport} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">{sport}</p>
                    <div className="flex flex-wrap gap-2">
                      {(SPORT_POSITIONS[sport] || []).map(pos => (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => togglePosition(sport, pos)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            (sportPositions[sport] || []).includes(pos)
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                          }`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label>Current Location(s)</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_LOCATIONS.map(loc => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocation(loc)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      locations.includes(loc)
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
              {loading ? 'Creating account...' : (otpVerified ? 'Create Account' : 'Verify Phone & Register')}
            </Button>
            <p className="text-center text-sm text-gray-500">
              Already have an account?{' '}
              <button type="button" onClick={onSwitchToLogin} className="text-green-600 hover:underline font-medium">
                Sign In
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
