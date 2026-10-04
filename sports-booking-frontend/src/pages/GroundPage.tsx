import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Calendar, Camera, Clock, IndianRupee, Info, Mail, MapPin, MessageCircle, Navigation, Phone, Shield, UserPlus, Users } from 'lucide-react';
import { sportIcon, sportLabel } from '@/lib/sports';
import { AMENITIES, AMENITY_GROUPS, amenityStatusText, directionsUrl, mapEmbedUrl, whatsappUrl, type GroundDetails } from '@/lib/grounds';

interface Props {
  groundId: number;
  onBack: () => void;
  onViewGame?: (gameId: number) => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Open for booking', open: 'Open', voting_open: 'Voting open', in_progress: 'Booked',
};

function formatGameDate(date: string, time: string) {
  const d = new Date(`${date}T${time || '00:00'}`);
  return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function ContactButtons({ phone, email }: { phone?: string; email?: string }) {
  return (
    <div className="flex gap-2">
      {phone && (
        <>
          <a href={`tel:${phone}`} className="p-2 rounded-full bg-green-50 text-green-700" aria-label="Call"><Phone size={16} /></a>
          <a href={whatsappUrl(phone)} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-emerald-50 text-emerald-600" aria-label="WhatsApp"><MessageCircle size={16} /></a>
        </>
      )}
      {email && <a href={`mailto:${email}`} className="p-2 rounded-full bg-blue-50 text-blue-600" aria-label="Email"><Mail size={16} /></a>}
    </div>
  );
}

export default function GroundPage({ groundId, onBack, onViewGame }: Props) {
  const { activeTheme } = useTheme();
  const [ground, setGround] = useState<GroundDetails | null>(null);
  const [error, setError] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showJoin, setShowJoin] = useState(false);
  const [joinSports, setJoinSports] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [joinStatus, setJoinStatus] = useState('');

  useEffect(() => {
    api.getGroundDetails(groundId)
      .then((data: GroundDetails) => { setGround(data); setJoinStatus(data.join_request_status); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load ground'));
  }, [groundId]);

  const submitJoin = async () => {
    if (!joinSports.trim()) { alert('Please enter the sports you play'); return; }
    try {
      await api.requestJoinGround(groundId, joinSports, joinMessage);
      setJoinStatus('pending');
      setShowJoin(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send request');
    }
  };

  if (error) return <div className="p-6 text-center text-red-600">{error} <button className="underline ml-2" onClick={onBack}>Back</button></div>;
  if (!ground) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading ground...</div>;

  const hasPin = ground.latitude != null && ground.longitude != null;
  const photo = ground.photos[photoIndex];
  const availableAmenities = AMENITIES.filter(a => ground.amenities[a.key] && ground.amenities[a.key].status !== 'no');
  const hasOwner = ground.owner_name || ground.owner_phone || ground.owner_email;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ backgroundColor: activeTheme.header_bg }}>
        <div className="max-w-2xl mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline"><ArrowLeft size={16} /> Back</button>
          <h1 className="text-xl font-bold">{ground.name}</h1>
          <p className="text-sm opacity-90 flex items-center gap-1"><MapPin size={14} /> {ground.address || ground.location}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {ground.sport_types.map(s => <Badge key={s} className="bg-white/20 text-white">{sportIcon(s)} {sportLabel(s)}</Badge>)}
            {ground.is_approved === 0 && <Badge className="bg-yellow-400 text-yellow-900">Awaiting approval</Badge>}
            {ground.is_approved === -1 && <Badge className="bg-red-500">Not approved</Badge>}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <a href={directionsUrl(ground)} target="_blank" rel="noreferrer">
            <Button className="w-full" style={{ backgroundColor: activeTheme.button_bg }}><Navigation size={16} className="mr-2" /> Directions</Button>
          </a>
          {ground.is_member ? (
            <Button variant="outline" disabled><Users size={16} className="mr-2" /> Member</Button>
          ) : joinStatus === 'pending' ? (
            <Button variant="outline" disabled>Request sent</Button>
          ) : (
            <Button variant="outline" onClick={() => setShowJoin(v => !v)}><UserPlus size={16} className="mr-2" /> Join ground</Button>
          )}
        </div>
        {showJoin && (
          <Card><CardContent className="p-3 space-y-2">
            <Input placeholder="Sports you play, e.g. Soccer" value={joinSports} onChange={e => setJoinSports(e.target.value)} />
            <Textarea rows={2} placeholder="Message to the moderator (optional)" value={joinMessage} onChange={e => setJoinMessage(e.target.value)} />
            <Button className="w-full" style={{ backgroundColor: activeTheme.button_bg }} onClick={submitJoin}>Send join request</Button>
          </CardContent></Card>
        )}
        {ground.rejection_reason && <p className="text-sm text-red-600">Reason: {ground.rejection_reason}</p>}

        <Tabs defaultValue="games">
          <TabsList className="w-full">
            <TabsTrigger value="games" className="flex-1 gap-1"><Calendar size={14} /> Games</TabsTrigger>
            <TabsTrigger value="photos" className="flex-1 gap-1"><Camera size={14} /> Photos</TabsTrigger>
            <TabsTrigger value="info" className="flex-1 gap-1"><Info size={14} /> Info</TabsTrigger>
          </TabsList>

          <TabsContent value="games" className="space-y-2">
            {ground.upcoming_games.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-gray-500">No upcoming games. Contact a moderator below to organise one.</CardContent></Card>
            ) : ground.upcoming_games.map(game => {
              const spotsLeft = Math.max(game.max_players - game.player_count, 0);
              return (
                <Card key={game.game_id}><CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{sportIcon(game.sport_type)} {game.title}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1"><Clock size={12} /> {formatGameDate(game.game_date, game.game_time)} · {game.duration_minutes} min</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {game.player_count}/{game.max_players} players · {spotsLeft > 0 ? <span className="text-green-700 font-medium">{spotsLeft} spots left</span> : <span className="text-orange-600">Full (waitlist)</span>}
                        {game.cost_per_person > 0 && <> · Rs {game.cost_per_person}/person</>}
                      </p>
                      <Badge variant="outline" className="text-[10px] mt-1">{STATUS_LABELS[game.status] || game.status}</Badge>
                    </div>
                    {onViewGame && <Button size="sm" className="shrink-0" style={{ backgroundColor: activeTheme.button_bg }} onClick={() => onViewGame(game.game_id)}>View & join</Button>}
                  </div>
                  {game.organiser_name && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t">
                      <span className="text-xs text-gray-600">Organiser: {game.organiser_name}</span>
                      <ContactButtons phone={game.organiser_phone} />
                    </div>
                  )}
                </CardContent></Card>
              );
            })}
          </TabsContent>

          <TabsContent value="photos">
            {ground.photos.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-gray-500">No photos yet.</CardContent></Card>
            ) : (
              <div className="space-y-2">
                <img src={api.getGroundPhotoUrl(photo.filename)} alt={photo.caption || ground.name} className="w-full h-60 object-cover rounded-lg" />
                {photo.caption && <p className="text-xs text-gray-500">{photo.caption}</p>}
                <div className="flex gap-2 overflow-x-auto">
                  {ground.photos.map((p, i) => (
                    <button key={p.id} onClick={() => setPhotoIndex(i)} className={`shrink-0 rounded border-2 ${i === photoIndex ? 'border-green-600' : 'border-transparent'}`}>
                      <img src={api.getGroundPhotoUrl(p.filename)} alt="" className="w-16 h-16 object-cover rounded" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="info" className="space-y-3">
            {hasPin && (
              <iframe title="Map" src={mapEmbedUrl(ground.latitude!, ground.longitude!)} className="w-full h-44 rounded-lg border-0" loading="lazy" />
            )}
            {(ground.description || ground.opening_hours || ground.price_info) && (
              <Card><CardContent className="p-3 space-y-1 text-sm text-gray-700">
                {ground.description && <p>{ground.description}</p>}
                {ground.opening_hours && <p className="flex items-center gap-2"><Clock size={14} className="text-gray-400" /> {ground.opening_hours}</p>}
                {ground.price_info && <p className="flex items-center gap-2"><IndianRupee size={14} className="text-gray-400" /> {ground.price_info}</p>}
              </CardContent></Card>
            )}
            {(availableAmenities.length > 0 || ground.amenities_other) && (
              <Card><CardContent className="p-3 space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">Amenities</h3>
                {AMENITY_GROUPS.map(group => {
                  const items = availableAmenities.filter(a => a.group === group.key);
                  if (items.length === 0) return null;
                  return (
                    <div key={group.key}>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{group.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(a => {
                          const status = amenityStatusText(ground.amenities[a.key], a.group);
                          return (
                            <span key={a.key} className="text-xs bg-gray-50 border rounded-full px-2 py-1 text-gray-700">
                              {a.emoji} {a.label}{status && <span className="text-gray-500"> · {status}</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {ground.amenities_other && <p className="text-xs text-gray-600">Also: {ground.amenities_other}</p>}
              </CardContent></Card>
            )}
            <Card><CardContent className="p-3 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">Contact</h3>
              {hasOwner ? (
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{ground.owner_name || 'Owner'} <span className="text-xs text-gray-400">· Owner</span></p>
                    <p className="text-xs text-gray-500 truncate">{[ground.owner_phone, ground.owner_email].filter(Boolean).join(' · ')}</p>
                  </div>
                  <ContactButtons phone={ground.owner_phone} email={ground.owner_email} />
                </div>
              ) : !ground.contact_public ? (
                <p className="text-xs text-gray-500">The owner prefers to be contacted through the moderators.</p>
              ) : null}
              {ground.moderators.map(m => (
                <div key={m.user_id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 flex items-center gap-1"><Shield size={12} className="text-purple-600" /> {m.name}</p>
                    <p className="text-xs text-gray-500">Moderator · {m.sport_type}</p>
                  </div>
                  <ContactButtons phone={m.phone} />
                </div>
              ))}
              {!hasOwner && ground.moderators.length === 0 && <p className="text-xs text-gray-500">No contacts listed yet.</p>}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
