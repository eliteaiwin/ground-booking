import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Smartphone, Chrome, Mail, Lock, ArrowLeft, Phone } from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: { theme?: string; size?: string; width?: number; text?: string }
          ) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

interface Props {
  onSwitchToRegister: () => void;
  onForgotPassword?: () => void;
  isAddUserMode?: boolean;
}

type LoginMode = 'choose' | 'password' | 'otp' | 'google';

export default function LoginPage({ onSwitchToRegister, onForgotPassword, isAddUserMode }: Props) {
  const { login, loginWithOTP, requestOTP, loginWithGoogle } = useAuth();
  const [loginMode, setLoginMode] = useState<LoginMode>('choose');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDemo, setOtpDemo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Pre-fill the last used identifier (phone or email)
  useEffect(() => {
    const last = localStorage.getItem('last_login_identifier') || '';
    setIdentifier(last);
  }, []);

  const handleGoogleCallback = useCallback(async (response: { credential: string }) => {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle(response.credential);
      localStorage.removeItem('last_login_identifier');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setLoading(false);
    }
  }, [loginWithGoogle]);

  useEffect(() => {
    if (loginMode !== 'google' || !GOOGLE_CLIENT_ID) return;

    const renderGoogleButton = () => {
      if (!window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCallback,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
      });
    };

    if (window.google) {
      renderGoogleButton();
    } else {
      const interval = setInterval(() => {
        if (window.google) {
          clearInterval(interval);
          renderGoogleButton();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [loginMode, handleGoogleCallback]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier, password);
      localStorage.setItem('last_login_identifier', identifier);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOTP = async () => {
    setError('');
    if (!identifier.trim()) {
      setError('Please enter your phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await requestOTP(identifier);
      setOtpSent(true);
      localStorage.setItem('last_login_identifier', identifier);
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
      await loginWithOTP(identifier, otp);
      localStorage.setItem('last_login_identifier', identifier);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const OptionButton = ({ icon, label, sublabel, active, onClick }: { icon: React.ReactNode; label: string; sublabel: string; active?: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-4 w-full p-4 rounded-xl border-2 transition-all text-left ${
        active ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white hover:border-green-400'
      }`}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}>
        {icon}
      </div>
      <div>
        <p className="font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{sublabel}</p>
      </div>
    </button>
  );

  const loginContent = (
    <CardContent className="space-y-5">
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>
      )}

      {loginMode === 'choose' && (
        <div className="space-y-3">
          <OptionButton
            icon={<Smartphone size={22} />}
            label="Login with OTP"
            sublabel="We will send a one-time code to your phone"
            onClick={() => setLoginMode('otp')}
          />
          <OptionButton
            icon={<Chrome size={22} />}
            label="Login with Google"
            sublabel="Use your Google account"
            onClick={() => setLoginMode('google')}
          />
          <OptionButton
            icon={<Mail size={22} />}
            label="Login with Email / Phone"
            sublabel="Use your phone number or email and password"
            onClick={() => setLoginMode('password')}
          />
        </div>
      )}

      {loginMode !== 'choose' && (
        <button
          type="button"
          onClick={() => { setLoginMode('choose'); setError(''); setOtpSent(false); setOtpDemo(''); }}
          className="flex items-center gap-1 text-sm text-green-600 hover:underline"
        >
          <ArrowLeft size={16} /> Back to options
        </button>
      )}

      {loginMode === 'password' && (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Phone or Email</Label>
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-3 text-gray-400" />
              <Input
                id="identifier"
                type="text"
                placeholder="Enter phone number or email"
                className="pl-10"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
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
          {onForgotPassword && (
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-sm text-green-600 hover:underline w-full text-center mt-2"
            >
              Forgot Password?
            </button>
          )}
        </form>
      )}

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
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
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
              disabled={loading || !identifier}
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

      {loginMode === 'google' && (
        <div className="space-y-4 text-center py-4">
          {GOOGLE_CLIENT_ID ? (
            <>
              <div ref={googleBtnRef} className="flex justify-center" />
              {loading && <p className="text-sm text-gray-500">Signing in with Google...</p>}
            </>
          ) : (
            <>
              <Chrome size={40} className="mx-auto text-gray-400" />
              <p className="text-sm text-gray-500">Google Sign-In is not configured.</p>
              <p className="text-xs text-gray-400">Set VITE_GOOGLE_CLIENT_ID to enable Google login.</p>
            </>
          )}
        </div>
      )}

      {!isAddUserMode && loginMode === 'choose' && (
        <>
          <Separator />
          <p className="text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <button type="button" onClick={onSwitchToRegister} className="text-green-600 hover:underline font-medium">
              Register
            </button>
          </p>
        </>
      )}
    </CardContent>
  );

  if (isAddUserMode) {
    return (
      <Card className="w-full max-w-md relative">
        {loginContent}
      </Card>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      {/* Sports collage background */}
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-0 opacity-20">
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&q=80)' }} />
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=600&q=80)' }} />
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=600&q=80)' }} />
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1519861531473-9200262188bf?w=600&q=80)' }} />
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1587280501635-68a0e82cd5ff?w=600&q=80)' }} />
        <div className="bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1461896836934-bd45ba8fcf9b?w=600&q=80)' }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-green-900/70 to-blue-900/70" />
      <Card className="w-full max-w-md relative z-10 shadow-2xl">
        <div className="text-center pt-8">
          <div className="mx-auto mb-4 w-24 h-24 bg-white rounded-2xl shadow-lg overflow-hidden">
            <img src="/turf-icon.png" alt="Turf Booking" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Turf Booking</h1>
          <p className="text-gray-500 mt-1">Sign in to your account</p>
        </div>
        {loginContent}
      </Card>
    </div>
  );
}
