import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Phone, Lock, Smartphone, Chrome } from 'lucide-react';

interface Props {
  onSwitchToRegister: () => void;
}

type LoginMode = 'password' | 'otp' | 'google';

export default function LoginPage({ onSwitchToRegister }: Props) {
  const { login, loginWithOTP, requestOTP, loginWithGoogle } = useAuth();
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDemo, setOtpDemo] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleFirstName, setGoogleFirstName] = useState('');
  const [googleLastName, setGoogleLastName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(phone, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOTP = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await requestOTP(phone);
      setOtpSent(true);
      if (res.otp_demo) {
        setOtpDemo(res.otp_demo);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleOTPLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginWithOTP(phone, otp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const googleId = `google_${googleEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await loginWithGoogle(googleId, googleEmail, googleFirstName, googleLastName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-green-600 rounded-full flex items-center justify-center">
            <span className="text-white text-2xl">&#9917;</span>
          </div>
          <CardTitle className="text-2xl font-bold">Ground Booking</CardTitle>
          <p className="text-gray-500 mt-1">Sign in to your account</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>
          )}

          {/* Login Mode Tabs */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => { setLoginMode('password'); setError(''); }}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                loginMode === 'password' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Lock size={18} />
              Password
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode('otp'); setError(''); setOtpSent(false); setOtpDemo(''); }}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                loginMode === 'otp' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Smartphone size={18} />
              Mobile OTP
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode('google'); setError(''); }}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                loginMode === 'google' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Chrome size={18} />
              Google
            </button>
          </div>

          <Separator />

          {/* Password Login */}
          {loginMode === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-gray-400" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="Enter your phone number"
                    className="pl-10"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-3 text-gray-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}

          {/* OTP Login */}
          {loginMode === 'otp' && (
            <form onSubmit={handleOTPLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp-phone">Phone Number</Label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-gray-400" />
                  <Input
                    id="otp-phone"
                    type="tel"
                    placeholder="Enter your phone number"
                    className="pl-10"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={otpSent}
                  />
                </div>
              </div>
              {!otpSent ? (
                <Button
                  type="button"
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={handleRequestOTP}
                  disabled={loading || !phone}
                >
                  {loading ? 'Sending OTP...' : 'Send OTP'}
                </Button>
              ) : (
                <>
                  {otpDemo && (
                    <div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm">
                      Demo OTP: <strong>{otpDemo}</strong> (In production, this would be sent via SMS)
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="otp">Enter OTP</Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      maxLength={6}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtpDemo(''); setOtp(''); }}
                    className="text-sm text-green-600 hover:underline w-full text-center"
                  >
                    Change phone number
                  </button>
                </>
              )}
            </form>
          )}

          {/* Google Login - disabled until proper OAuth is implemented */}
          {loginMode === 'google' && (
            <div className="space-y-4 text-center py-6">
              <Chrome size={40} className="mx-auto text-gray-400" />
              <p className="text-sm text-gray-500">
                Google Sign-In is coming soon.
              </p>
              <p className="text-xs text-gray-400">
                Please use Password or Mobile OTP login for now.
              </p>
            </div>
          )}

          <Separator />

          <p className="text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <button type="button" onClick={onSwitchToRegister} className="text-green-600 hover:underline font-medium">
              Register
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
