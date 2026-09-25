import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Smartphone, Mail, ArrowLeft, Phone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';

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
const APPLE_CLIENT_ID = 'com.elitedev.turfbooking';
const APPLE_SIGN_IN_AVAILABLE = Capacitor.getPlatform() === 'ios';

const GoogleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#000" aria-hidden="true">
    <path d="M16.37 12.7c.02 2.9 2.54 3.86 2.57 3.88-.02.07-.4 1.38-1.33 2.73-.8 1.17-1.63 2.33-2.94 2.35-1.29.02-1.7-.76-3.17-.76-1.47 0-1.93.74-3.15.79-1.26.05-2.22-1.26-3.03-2.42-1.65-2.39-2.91-6.75-1.22-9.69.84-1.46 2.35-2.39 3.98-2.41 1.24-.02 2.41.84 3.17.84.76 0 2.18-1.03 3.68-.88.63.03 2.39.25 3.52 1.91-.09.06-2.1 1.23-2.08 3.66zM13.94 5.5c.67-.81 1.12-1.94 1-3.06-.97.04-2.13.64-2.83 1.45-.62.72-1.16 1.87-1.01 2.97 1.08.08 2.17-.55 2.84-1.36z"/>
  </svg>
);

interface Props {
  onSwitchToRegister?: () => void;
  onForgotPassword?: () => void;
  isAddUserMode?: boolean;
}

type LoginMode = 'choose' | 'email' | 'otp' | 'google';

export default function LoginPage({ isAddUserMode }: Props) {
  const { loginWithOTP, requestOTP, loginWithGoogle, loginWithApple } = useAuth();
  const [loginMode, setLoginMode] = useState<LoginMode>('choose');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDemo, setOtpDemo] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
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

  const handleAppleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const { response } = await SignInWithApple.authorize({
        clientId: APPLE_CLIENT_ID,
        redirectURI: 'https://elite-turf-booking.fly.dev/auth/apple/callback',
        scopes: 'email name',
      });
      await loginWithApple(response.identityToken, response.givenName, response.familyName);
      localStorage.removeItem('last_login_identifier');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (!/cancel/i.test(msg)) setError(msg || 'Apple login failed');
    } finally {
      setLoading(false);
    }
  };

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

  const handleRequestOTP = async () => {
    setError('');
    if (!identifier.trim()) {
      setError(loginMode === 'email' ? 'Please enter your email' : 'Please enter your phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await requestOTP(identifier);
      setOtpSent(true);
      localStorage.setItem('last_login_identifier', identifier);
      setIsNewUser(Boolean(res.new_user));
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

  const OptionButton = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
    >
      <span className="w-6 h-6 flex items-center justify-center shrink-0">{icon}</span>
      <span className="font-medium text-gray-900 text-sm">{label}</span>
    </button>
  );

  const isEmailMode = loginMode === 'email';

  const loginContent = (
    <CardContent className="space-y-4 pt-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>
      )}

      {loginMode === 'choose' && (
        <div className="space-y-2">
          <OptionButton
            icon={<Smartphone size={22} className="text-green-600" />}
            label="Login with OTP"
            onClick={() => setLoginMode('otp')}
          />
          {APPLE_SIGN_IN_AVAILABLE && (
            <OptionButton
              icon={<AppleIcon />}
              label="Sign in with Apple"
              onClick={handleAppleLogin}
            />
          )}
          {GOOGLE_CLIENT_ID && (
            <OptionButton
              icon={<GoogleIcon />}
              label="Login with Google"
              onClick={() => setLoginMode('google')}
            />
          )}
          <OptionButton
            icon={<Mail size={22} className="text-blue-600" />}
            label="Login with Email"
            onClick={() => setLoginMode('email')}
          />
        </div>
      )}

      {loginMode !== 'choose' && (
        <button
          type="button"
          onClick={() => { setLoginMode('choose'); setError(''); setOtpSent(false); setOtp(''); setOtpDemo(''); }}
          className="flex items-center gap-1 text-sm text-green-600 hover:underline"
        >
          <ArrowLeft size={16} /> Back to options
        </button>
      )}

      {(loginMode === 'otp' || loginMode === 'email') && (
        <form onSubmit={handleOTPLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp-identifier">{isEmailMode ? 'Email' : 'Phone Number'}</Label>
            <div className="relative">
              {isEmailMode
                ? <Mail size={16} className="absolute left-3 top-3 text-gray-400" />
                : <Phone size={16} className="absolute left-3 top-3 text-gray-400" />}
              <Input
                id="otp-identifier"
                type={isEmailMode ? 'email' : 'tel'}
                placeholder={isEmailMode ? 'Enter your email' : 'Enter your phone number'}
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
              {loading ? 'Sending code...' : 'Send code'}
            </Button>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                We sent a 6-digit code to <strong>{identifier}</strong>.
                {isNewUser && " We'll create your account when you verify it."}
              </p>
              {otpDemo && (
                <div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm">
                  Demo code: <strong>{otpDemo}</strong>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="otp">Enter code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
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
                onClick={() => { setOtpSent(false); setOtpDemo(''); setOtp(''); setIsNewUser(false); }}
                className="text-sm text-green-600 hover:underline w-full text-center"
              >
                {isEmailMode ? 'Change email' : 'Change phone number'}
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
              <GoogleIcon />
              <p className="text-sm text-gray-500">Google Sign-In is not configured.</p>
              <p className="text-xs text-gray-400">Set VITE_GOOGLE_CLIENT_ID to enable Google login.</p>
            </>
          )}
        </div>
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
        <div className="text-center pt-6">
          <div className="mx-auto mb-3 w-20 h-20 bg-white rounded-2xl shadow-lg overflow-hidden">
            <img src="/turf-icon.png" alt="Elite Turf Booking" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900"><span className="text-red-600">Elite</span> Turf Booking</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to your account</p>
        </div>
        {loginContent}
      </Card>
    </div>
  );
}
