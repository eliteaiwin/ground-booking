import { useState } from 'react';
import { api } from '../services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Mail, ArrowLeft, Key } from 'lucide-react';

interface Props {
  onBack: () => void;
}

export default function ForgotPassword({ onBack }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState('');

  // Token-based reset form
  const [tokenInput, setTokenInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.forgotPassword({ email });
      setSent(true);
      // Demo mode: show the token
      if (res.reset_token_demo) {
        setResetToken(res.reset_token_demo);
        setTokenInput(res.reset_token_demo);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (newPassword.length < 6) {
      setResetError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match');
      return;
    }

    setResetLoading(true);
    try {
      await api.resetPasswordToken({ token: tokenInput, new_password: newPassword });
      setResetSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset password';
      setResetError(msg);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft size={16} /> Back to Login
          </button>

          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Mail className="text-blue-600" size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">Forgot Password</h2>
            <p className="text-sm text-gray-500 mt-1">
              Enter your registered email to receive a password reset link
            </p>
          </div>

          {resetSuccess ? (
            <div className="text-center py-4">
              <div className="text-green-600 font-semibold mb-2">Password reset successfully!</div>
              <p className="text-sm text-gray-500 mb-4">Please login with your new password.</p>
              <Button onClick={onBack} className="w-full">Go to Login</Button>
            </div>
          ) : !sent ? (
            <form onSubmit={handleSendReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="your@email.com"
                  required
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 text-green-700 p-3 rounded-md text-sm">
                If the email is registered, a reset link has been sent.
              </div>

              {resetToken && (
                <div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm">
                  <Key size={14} className="inline mr-1" />
                  <strong>Demo Mode:</strong> Reset token: <code className="bg-blue-100 px-1 rounded text-xs break-all">{resetToken}</code>
                  <p className="text-xs text-blue-500 mt-1">(In production, this would be sent via email as a link)</p>
                </div>
              )}

              <form onSubmit={handleResetPassword} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reset Token</label>
                  <input
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    placeholder="Paste your reset token"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Min 6 characters"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                    minLength={6}
                  />
                </div>
                {resetError && <p className="text-red-500 text-sm">{resetError}</p>}
                <Button type="submit" className="w-full" disabled={resetLoading}>
                  {resetLoading ? 'Resetting...' : 'Reset Password'}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => { setSent(false); setResetToken(''); setTokenInput(''); }}
                className="text-sm text-green-600 hover:underline w-full text-center"
              >
                Try a different email
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
