import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileText } from 'lucide-react';

interface Settlement {
  id: number;
  game_id: number;
  game_title: string;
  game_date: string;
  sport_type: string;
  ground_name: string;
  user_id: number;
  user_name: string;
  user_phone: string;
  moderator_id: number;
  moderator_name: string;
  comment: string;
  action_date: string;
}

interface Props {
  onBack: () => void;
}

export default function BackendSettlement({ onBack }: Props) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSettlements().then(data => {
      setSettlements(data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const formatDate = (d: string) => {
    if (!d) return '';
    try { return new Date(d).toLocaleString(); } catch { return d; }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">Back-end Settlement</h1>
          <p className="text-sm text-purple-200">All Mark as Paid actions logged here</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : settlements.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <FileText size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No settlement records yet</p>
              <p className="text-xs text-gray-400 mt-1">Records appear here when payments are marked as paid</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-gray-500">{settlements.length} record(s) - sorted by most recent</p>
            {settlements.map(s => (
              <Card key={s.id} className="border-l-4 border-l-purple-400">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{s.user_name}</p>
                    <Badge className="bg-purple-100 text-purple-700 text-xs">{s.user_phone}</Badge>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <p><strong>Game:</strong> {s.game_title} ({s.game_date})</p>
                    <p><strong>Ground:</strong> {s.ground_name}</p>
                    <p><strong>Marked by:</strong> {s.moderator_name}</p>
                    <p><strong>Action Date:</strong> {formatDate(s.action_date)}</p>
                    {s.comment && (
                      <div className="mt-2 bg-gray-100 rounded-md p-2">
                        <p className="text-xs text-gray-500">Comment:</p>
                        <p className="text-sm">{s.comment}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
