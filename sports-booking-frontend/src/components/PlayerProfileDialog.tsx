import { useEffect, useState, type ReactNode } from 'react';
import { ContactReveal } from '@/components/ContactReveal';
import { maskedPhoneText } from '@/lib/player';
import { X, Sparkles, Trophy, Goal, Frown, Wallet, Flame, Users } from 'lucide-react';
import { api } from '../services/api';
import { PlayerAvatar } from './PlayerAvatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { sportIconChar, sportLabel } from '../lib/sportIcon';
import { useAuth } from '../context/AuthContext';
import PaymentHistory from './PaymentHistory';

export interface PlayerSummary {
  id: number;
  name: string;
  display_name: string;
  phone: string;
  email: string;
  contact_visible: boolean;
  pay_first?: boolean;
  can_set_pay_first?: boolean;
  age: number | null;
  sports: string[];
  sport_positions: Record<string, string[]>;
  locations: string[];
  roles: string[];
  member_since: string;
  profile_pic: string;
  gender?: string;
  stats: { rank: number | null; games_played: number; potd_wins: number; potd_points: number; goals: number };
  grounds: { ground_name: string; games: number }[];
  photos: { id: number; filename: string; purpose: string }[];
  game_photos: { id: number; file_path: string; caption: string; ground_name: string; game_date: string }[];
}

interface Props {
  userId: number;
  onClose: () => void;
  /** Sport of the game the popup was opened from; that sport's photo becomes the main photo. */
  sport?: string;
  /** Game the popup was opened from; the Payment tab then shows only that game's series. */
  gameId?: number;
  /** Extra context-specific content shown at the bottom of the Info tab . */
  children?: ReactNode;
}

const mediaUrl = (path: string) => `${import.meta.env.VITE_API_URL || ''}${path}`;

const insightIcon = (category: string) => {
  switch (category) {
    case 'goals': return <Goal size={16} className="text-green-600" />;
    case 'own_goals': return <Frown size={16} className="text-red-500" />;
    case 'payments': return <Wallet size={16} className="text-blue-600" />;
    case 'streak': return <Flame size={16} className="text-orange-500" />;
    case 'fame': return <Trophy size={16} className="text-yellow-500" />;
    default: return <Users size={16} className="text-purple-600" />;
  }
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3">
    <span className="text-gray-500 shrink-0">{label}</span>
    <span className="font-medium text-right break-all">{children}</span>
  </div>
);

export default function PlayerProfileDialog({ userId, onClose, sport, gameId, children }: Props) {
  const { user } = useAuth();
  const canSeePayments = !!user && (user.id === userId || user.roles.some(r => r === 'admin' || r === 'moderator'));
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const [insights, setInsights] = useState<{ category: string; text: string }[] | null>(null);
  const [insightsError, setInsightsError] = useState('');
  const [enlarged, setEnlarged] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError('');
    setTab('info');
    setInsights(null);
    setInsightsError('');
    api.getUserSummary(userId)
      .then((d: PlayerSummary) => { if (active) setSummary(d); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Failed to load player'); });
    return () => { active = false; };
  }, [userId]);

  const showTab = (t: string) => {
    setTab(t);
    if (t !== 'insights' || insights) return;
    api.getPlayerInsights(userId)
      .then((d: { insights: { category: string; text: string }[] }) => setInsights(d.insights || []))
      .catch((e: unknown) => setInsightsError(e instanceof Error ? e.message : 'Failed to load insights'));
  };

  const s = summary;
  const photoCount = s ? s.photos.length + s.game_photos.length : 0;
  const mainPhoto = (s && sport && s.photos.find(p => p.purpose === sport.toLowerCase())?.filename) || s?.profile_pic || '';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg max-w-sm w-full p-5 relative max-h-[90vh] overflow-y-auto"
        data-profile-modal
        onMouseDown={e => e.stopPropagation()}
      >
        <button type="button" aria-label="Close" className="absolute top-3 right-3 text-gray-400 hover:text-gray-600" onClick={onClose}>
          <X size={18} />
        </button>
        {error ? (
          <p className="text-sm text-red-600 text-center py-6">{error}</p>
        ) : !s ? (
          <p className="text-sm text-gray-500 text-center py-6">Loading...</p>
        ) : (
          <>
            <div className="flex flex-col items-center mb-4">
              {mainPhoto ? (
                <button type="button" onClick={() => setEnlarged(api.getProfilePicUrl(mainPhoto))}>
                  <img src={api.getProfilePicUrl(mainPhoto)} alt={s.name} data-testid="profile-main-photo" className="w-20 h-20 rounded-full object-cover mb-2" />
                </button>
              ) : (
                <span className="mb-2"><PlayerAvatar size="lg" gender={s.gender} /></span>
              )}
              <h3 className="text-lg font-bold text-center">{s.display_name || s.name}</h3>
              {s.display_name && <p className="text-xs text-gray-500">{s.name}</p>}
              {s.sports.length > 0 && (
                <p className="text-sm mt-1" title={s.sports.map(sportLabel).join(', ')}>{s.sports.map(sportIconChar).join(' ')}</p>
              )}
            </div>
            <Tabs value={tab} onValueChange={showTab}>
              <TabsList className="w-full mb-3">
                <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
                <TabsTrigger value="photos" className="flex-1">Photos{photoCount ? ` (${photoCount})` : ''}</TabsTrigger>
                <TabsTrigger value="insights" className="flex-1 gap-1">
                  <Sparkles size={14} className="text-purple-500" /> Insights
                </TabsTrigger>
                {canSeePayments && <TabsTrigger value="payments" className="flex-1">Payment</TabsTrigger>}
              </TabsList>
              <TabsContent value="info">
                <div className="space-y-2 text-sm">
                  <Row label="Full Name">{s.name}</Row>
                  {s.display_name && <Row label="Display Name">{s.display_name}</Row>}
                  {s.phone && (
                    <Row label="Phone">{s.contact_visible ? <ContactReveal value={s.phone} kind="phone" /> : maskedPhoneText(s.phone)}</Row>
                  )}
                  {s.contact_visible && s.email && <Row label="Email"><ContactReveal value={s.email} kind="email" /></Row>}
                  <Row label="Age">{s.age ?? '—'}</Row>
                  {s.locations.length > 0 && <Row label="Locations">{s.locations.join(', ')}</Row>}
                  {s.sports.map(sp => (
                    <Row key={sp} label={`${sportIconChar(sp)} ${sportLabel(sp)}`}>
                      {(s.sport_positions[sp] || []).join(', ') || 'Any position'}
                    </Row>
                  ))}
                  <div className="pt-2 border-t space-y-2">
                    {s.stats.rank && <Row label="Rank">#{s.stats.rank}</Row>}
                    <Row label="Player of the Day">{s.stats.potd_wins}/{s.stats.games_played}</Row>
                    <Row label="POTD Points">{s.stats.potd_points}</Row>
                    <Row label="Goals">{s.stats.goals}</Row>
                    <Row label="Games Played">{s.stats.games_played}</Row>
                  </div>
                  {s.grounds.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-gray-500 mb-1">Plays at</p>
                      <ul className="space-y-1">
                        {s.grounds.map(g => (
                          <li key={g.ground_name} className="flex justify-between text-xs">
                            <span>{g.ground_name}</span><span className="text-gray-500">{g.games} game{g.games !== 1 ? 's' : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.member_since && <p className="text-xs text-gray-400 pt-1">Member since {s.member_since.slice(0, 10)}</p>}
                  {children}
                </div>
              </TabsContent>
              <TabsContent value="photos">
                {photoCount === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No photos yet</p>
                ) : (
                  <div className="space-y-3">
                    {s.photos.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Profile photos</p>
                        <div className="grid grid-cols-3 gap-2">
                          {s.photos.map(p => (
                            <button type="button" key={`p${p.id}-${p.filename}`} onClick={() => setEnlarged(api.getProfilePicUrl(p.filename))} className="relative">
                              <img src={api.getProfilePicUrl(p.filename)} alt={p.purpose} className="w-full aspect-square object-cover rounded" />
                              {p.purpose && p.purpose !== 'profile' && (
                                <span className="absolute bottom-0 inset-x-0 text-[10px] bg-black/50 text-white rounded-b">{sportLabel(p.purpose)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.game_photos.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">From games</p>
                        <div className="grid grid-cols-3 gap-2">
                          {s.game_photos.map(p => (
                            <button type="button" key={`g${p.id}`} onClick={() => setEnlarged(mediaUrl(p.file_path))} className="text-left">
                              <img src={mediaUrl(p.file_path)} alt={p.caption || p.ground_name} className="w-full aspect-square object-cover rounded" />
                              <span className="block text-[10px] text-gray-500 truncate">{p.ground_name} · {p.game_date}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="insights">
                {insightsError ? (
                  <p className="text-sm text-red-600 text-center py-4">{insightsError}</p>
                ) : !insights ? (
                  <p className="text-sm text-gray-500 text-center py-4">Analysing games...</p>
                ) : insights.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Not enough games yet</p>
                ) : (
                  <ul className="space-y-2 max-h-80 overflow-y-auto">
                    {insights.map((insight, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm bg-gray-50 rounded-lg p-2">
                        <span className="mt-0.5 shrink-0">{insightIcon(insight.category)}</span>
                        <span className="text-gray-800">{insight.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              {canSeePayments && (
                <TabsContent value="payments">
                  {tab === 'payments' && <PaymentHistory userId={userId} gameId={gameId} showGame={!gameId} />}
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </div>
      {enlarged && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onMouseDown={e => { e.stopPropagation(); setEnlarged(null); }}>
          <img src={enlarged} alt="" className="max-w-full max-h-full rounded" />
        </div>
      )}
    </div>
  );
}
