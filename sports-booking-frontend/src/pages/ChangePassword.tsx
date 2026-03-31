import { useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Lock } from 'lucide-react';

interface Props {
  isForced?: boolean;
  onComplete: () => void;
}

export default function ChangePassword({ isForced, onComplete }: Props) {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const data: { current_password?: string; new_password: string } = {
        new_password: newPassword,
      };
      if (!isForced) {
        data.current_password = currentPassword;
      }
      await api.changePassword(data);
      setSuccess(true);
      localStorage.removeItem('force_password_change');
      // Force logout after password change
      setTimeout(() => {
        logout();
        onComplete();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="text-orange-600" size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">
              {isForced ? 'Password Change Required' : 'Change Password'}
            </h2>
            {isForced && (
              <p className="text-sm text-gray-500 mt-1">
                Your administrator has required you to change your password before continuing.
              </p>
            )}
          </div>

          {success ? (
            <div className="text-center py-4">
              <div className="text-green-600 font-semibold mb-2">Password changed successfully!</div>
              <p className="text-sm text-gray-500">You will be logged out. Please login with your new password.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isForced && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
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
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Changing...' : 'Change Password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
