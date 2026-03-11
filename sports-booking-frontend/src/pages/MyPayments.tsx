import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CreditCard } from 'lucide-react';

interface Payment {
  id: number;
  game_id: number;
  game_title: string;
  sport_type: string;
  game_date: string;
  game_time: string;
  ground_name: string;
  amount: number;
  status: string;
  paid_at: string | null;
}

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return <span>&#9917;</span>;
  if (type === 'cricket') return <span>&#127951;</span>;
  if (type === 'badminton') return <span>&#127992;</span>;
  if (type === 'basketball') return <span>&#127936;</span>;
  if (type === 'hockey') return <span>&#127954;</span>;
  return <span>&#127941;</span>;
};

interface Props {
  onBack: () => void;
}

export default function MyPayments({ onBack }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.myPayments().then(setPayments).finally(() => setLoading(false));
  }, []);

  const totalPending = payments.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);
  const totalPaid = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">My Payments</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-700">${totalPaid.toFixed(2)}</p>
              <p className="text-xs text-green-600">Total Paid</p>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-700">${totalPending.toFixed(2)}</p>
              <p className="text-xs text-red-600">Pending</p>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : payments.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              <CreditCard size={32} className="mx-auto mb-2 opacity-50" />
              No payments yet
            </CardContent>
          </Card>
        ) : (
          payments.map(payment => (
            <Card key={payment.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{sportIcon(payment.sport_type)}</span>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-800">{payment.game_title}</h4>
                    <p className="text-xs text-gray-500">{payment.ground_name} - {payment.game_date}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">${payment.amount.toFixed(2)}</p>
                    <Badge className={payment.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                      {payment.status === 'paid' ? 'Paid' : 'Pending'}
                    </Badge>
                  </div>
                </div>
                {payment.paid_at && (
                  <p className="text-xs text-gray-400 mt-2">Paid: {new Date(payment.paid_at).toLocaleString()}</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
