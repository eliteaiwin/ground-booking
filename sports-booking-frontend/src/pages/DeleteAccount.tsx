import { useState } from 'react';
import { api } from '../services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Trash2, AlertTriangle } from 'lucide-react';

export default function DeleteAccount() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setLoading(true);
    try {
      await api.deleteAccount({ phone, password, reason: reason || undefined });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account';
      setError(msg);
      setConfirmStep(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-2xl">&#9917;</span>
            </div>
            <h1 className="text-xl font-bold text-gray-800">Turf Booking</h1>
            <h2 className="text-lg font-semibold text-red-600 mt-2">Delete Account</h2>
            <p className="text-sm text-gray-500 mt-1">
              Permanently delete your Turf Booking account and all associated data
            </p>
          </div>

          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 className="text-green-600" size={24} />
              </div>
              <div className="text-green-700 font-semibold mb-2">Account deleted successfully</div>
              <p className="text-sm text-gray-500">
                Your account and all associated data have been permanently removed from Turf Booking.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
                  <div className="text-sm text-amber-800">
                    <strong>Warning:</strong> This action is irreversible. Deleting your account will permanently remove:
                    <ul className="list-disc ml-4 mt-1 space-y-0.5">
                      <li>Your profile and personal information</li>
                      <li>Game history and statistics</li>
                      <li>Payment records</li>
                      <li>Player of the Day votes and achievements</li>
                      <li>All photos and preferences</li>
                    </ul>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); setConfirmStep(false); }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Enter your registered phone number"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setConfirmStep(false); }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Enter your password"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                    placeholder="Tell us why you're leaving (optional)"
                    rows={3}
                    disabled={loading}
                  />
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                {confirmStep && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <p className="text-sm text-red-700 font-medium">
                      Are you sure? Click "Delete My Account" again to confirm permanent deletion.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  className={`w-full ${confirmStep ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'}`}
                  disabled={loading}
                >
                  {loading ? 'Deleting...' : confirmStep ? 'Confirm Delete My Account' : 'Delete My Account'}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t text-center">
            <p className="text-xs text-gray-400">
              Need help? Contact us at support@turfbooking.app
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
