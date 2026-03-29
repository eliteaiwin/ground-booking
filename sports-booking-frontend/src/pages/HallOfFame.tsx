import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Trophy, Medal, Star, Target } from 'lucide-react';

interface Ranking {
  rank: number;
  user_id: number;
  name: string;
  first_name: string;
  phone: string;
  potd_points: number;
  first_pref_wins: number;
  total_goals: number;
  games_played: number;
  combined_score: number;
}

interface Props {
  onBack: () => void;
}

const formatPlayerDisplay = (name: string, phone: string) => {
  const firstName = name.split(' ')[0];
  if (!phone || phone.length < 4) return firstName;
  const masked = phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
  return `${firstName} - ${masked}`;
};

export default function HallOfFame({ onBack }: Props) {
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRankings();
  }, [sportFilter]);

  const loadRankings = async () => {
    setLoading(true);
    try {
      const data = await api.getHallOfFame(sportFilter === 'all' ? undefined : sportFilter);
      setRankings(data.rankings || []);
    } catch (err) {
      console.error('Failed to load hall of fame:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy size={24} className="text-yellow-500" />;
    if (rank === 2) return <Medal size={24} className="text-gray-400" />;
    if (rank === 3) return <Medal size={24} className="text-amber-600" />;
    return <span className="w-6 h-6 flex items-center justify-center text-sm font-bold text-gray-400">{rank}</span>;
  };

  const getRankBg = (rank: number) => {
    if (rank === 1) return 'bg-gradient-to-r from-yellow-50 to-amber-50 border-yellow-200';
    if (rank === 2) return 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200';
    if (rank === 3) return 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200';
    return 'bg-white border-gray-100';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-yellow-500 to-amber-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <Trophy size={32} />
            <div>
              <h1 className="text-xl font-bold">Hall of Fame</h1>
              <p className="text-sm text-white/80">Player rankings by POTD points + goals</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Sport Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Sport:</span>
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              <SelectItem value="soccer">Soccer</SelectItem>
              <SelectItem value="cricket">Cricket</SelectItem>
              <SelectItem value="badminton">Badminton</SelectItem>
              <SelectItem value="basketball">Basketball</SelectItem>
              <SelectItem value="hockey">Hockey</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={loadRankings}>Refresh</Button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Star size={12} className="text-yellow-500" /> POTD Points</span>
          <span className="flex items-center gap-1"><Target size={12} className="text-green-500" /> Goals Scored</span>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading rankings...</div>
        ) : rankings.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              <Trophy size={48} className="mx-auto mb-3 text-gray-300" />
              <p>No rankings yet. Complete some games and vote for Player of the Day!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rankings.map((r) => (
              <Card key={r.user_id} className={`border ${getRankBg(r.rank)} transition-all hover:shadow-md`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    {getRankIcon(r.rank)}
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold truncate ${r.rank <= 3 ? 'text-gray-800' : 'text-gray-600'}`}>
                        {formatPlayerDisplay(r.name, r.phone)}
                      </p>
                      <div className="flex gap-3 mt-0.5">
                        <span className="text-xs text-yellow-600 flex items-center gap-0.5">
                          <Star size={10} /> {r.potd_points} POTD pts
                        </span>
                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <Target size={10} /> {r.total_goals} goals
                        </span>
                        <span className="text-xs text-gray-400">
                          {r.games_played} games
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={r.rank === 1 ? 'bg-yellow-500 text-white' : r.rank <= 3 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}>
                        {r.combined_score} pts
                      </Badge>
                      {r.first_pref_wins > 0 && (
                        <p className="text-xs text-yellow-600 mt-0.5">{r.first_pref_wins}x 1st pick</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
