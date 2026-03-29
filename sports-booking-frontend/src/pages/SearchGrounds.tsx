import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Search, MapPin, Building, Phone, Shield, Users, ChevronDown, ChevronUp, UserPlus } from 'lucide-react';

interface Moderator {
  user_id: number;
  name: string;
  phone: string;
  sport_type: string;
}

interface GroundResult {
  id: number;
  name: string;
  location: string;
  display_name: string;
  ground_code_display: string;
  is_approved: number;
  moderators: Moderator[];
}

interface Location {
  id: number;
  name: string;
}

interface GamePlayer {
  user_id: number;
  name: string;
  status: string;
  position: string;
}

interface GameInfo {
  game_id: number;
  title: string;
  sport_type: string;
  status: string;
  game_date: string;
  game_time: string;
  players: GamePlayer[];
}

interface Props {
  onBack: () => void;
}

const sportIconChar = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'voting_open': return 'Open for Voting';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
};

const formatPlayerName = (name: string) => (name || '').split(' ')[0];

const statusColor = (status: string) => {
  switch (status) {
    case 'voting_open': return 'bg-green-100 text-green-700';
    case 'in_progress': return 'bg-blue-100 text-blue-700';
    case 'completed': return 'bg-purple-100 text-purple-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

export default function SearchGrounds({ onBack }: Props) {
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [results, setResults] = useState<GroundResult[]>([]);
  const [searchLocation, setSearchLocation] = useState('');
  const [searchName, setSearchName] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedGround, setExpandedGround] = useState<number | null>(null);
  const [groundGames, setGroundGames] = useState<GameInfo[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [selectedSport, setSelectedSport] = useState('');
  const [joinGroundId, setJoinGroundId] = useState<number | null>(null);
  const [joinSports, setJoinSports] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState('');

  const handleJoinRequest = async (groundId: number) => {
    if (!joinSports.trim()) { alert('Please specify your sport interests'); return; }
    setJoinLoading(true);
    try {
      await api.requestJoinGround(groundId, joinSports, joinMessage);
      setJoinSuccess('Join request submitted! A moderator will review it.');
      setJoinGroundId(null);
      setJoinSports('');
      setJoinMessage('');
      setTimeout(() => setJoinSuccess(''), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setJoinLoading(false);
    }
  };

  // User's sport interests
  const userSports: string[] = user?.sports ? (typeof user.sports === 'string' ? (user.sports as string).split(',').filter(Boolean) : user.sports) : [];

  useEffect(() => {
    api.listLocations().then(setLocations).catch(console.error);
    handleSearch();
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await api.searchGrounds(
        searchLocation && searchLocation !== 'all' ? searchLocation : undefined,
        searchName || undefined
      );
      setResults(data);
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewPlayers = async (groundId: number, sportType?: string) => {
    if (expandedGround === groundId && !sportType) {
      setExpandedGround(null);
      setGroundGames([]);
      return;
    }
    setExpandedGround(groundId);
    setLoadingPlayers(true);
    try {
      const data = await api.getGroundPlayers(groundId, sportType || selectedSport || undefined);
      setGroundGames(data.games || []);
    } catch (err) {
      console.error(err);
      setGroundGames([]);
    } finally {
      setLoadingPlayers(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Search size={20} /> Search Grounds
          </h1>
          <p className="text-sm text-green-100 mt-1">Find grounds, moderators & see who is playing</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2">
              <Label>Filter by Location</Label>
              <Select value={searchLocation} onValueChange={setSearchLocation}>
                <SelectTrigger><SelectValue placeholder="All locations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Search by Name</Label>
              <Input
                placeholder="e.g. Whitefield"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={loading} className="w-full bg-green-600 hover:bg-green-700">
              <Search size={16} className="mr-2" />
              {loading ? 'Searching...' : 'Search Grounds'}
            </Button>
          </CardContent>
        </Card>

        {searched && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{results.length} ground{results.length !== 1 ? 's' : ''} found</p>
            {results.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  <Building size={24} className="mx-auto mb-2 text-gray-400" />
                  No grounds found. Try a different search.
                </CardContent>
              </Card>
            )}
            {joinSuccess && (
              <div className="bg-green-50 text-green-700 p-3 rounded-md text-sm">{joinSuccess}</div>
            )}
            {results.map(ground => (
              <Card key={ground.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin size={16} className="text-green-600" />
                    {ground.display_name}
                    {ground.ground_code_display && (
                      <Badge variant="outline" className="text-xs font-mono ml-auto">{ground.ground_code_display}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-100 text-green-700 text-xs">{ground.location}</Badge>
                    <Badge variant="outline" className="text-xs">{ground.name}</Badge>
                  </div>

                  {ground.moderators.length > 0 ? (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                        <Shield size={14} className="text-purple-600" /> Moderators
                      </p>
                      <div className="space-y-2">
                        {ground.moderators.map((mod, idx) => (
                          <div key={`${mod.user_id}-${idx}`} className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                            <Shield size={12} className="text-purple-600" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{mod.name}</p>
                              <p className="text-xs text-gray-500">{mod.sport_type}</p>
                            </div>
                            <a href={`tel:${mod.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Phone size={12} /> {mod.phone}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No moderators assigned yet</p>
                  )}

                  {/* Join Request */}
                  <div className="mt-3 border-t pt-3">
                    {joinGroundId === ground.id ? (
                      <div className="space-y-2 mb-3">
                        <Label className="text-sm">Your Sport Interests</Label>
                        <Input
                          placeholder="e.g. Soccer, Cricket"
                          value={joinSports}
                          onChange={e => setJoinSports(e.target.value)}
                        />
                        <Label className="text-sm">Message (optional)</Label>
                        <Textarea
                          placeholder="Hi, I'd like to join..."
                          value={joinMessage}
                          onChange={e => setJoinMessage(e.target.value)}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={joinLoading}
                            onClick={() => handleJoinRequest(ground.id)}>
                            {joinLoading ? 'Submitting...' : 'Submit Request'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setJoinGroundId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="mb-3 text-xs" onClick={() => setJoinGroundId(ground.id)}>
                        <UserPlus size={12} className="mr-1" /> Request to Join
                      </Button>
                    )}
                  </div>

                  {/* View Players section */}
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {userSports.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {userSports.map(s => (
                            <button key={s}
                              onClick={() => { setSelectedSport(s); handleViewPlayers(ground.id, s); }}
                              className={`text-xs px-2 py-1 rounded-full border ${selectedSport === s && expandedGround === ground.id ? 'bg-green-100 border-green-400 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-green-50'}`}>
                              {sportIconChar(s)} {s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                      <Button size="sm" variant="outline" className="ml-auto text-xs h-7"
                        onClick={() => handleViewPlayers(ground.id)}>
                        <Users size={12} className="mr-1" />
                        {expandedGround === ground.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {expandedGround === ground.id ? ' Hide' : ' Players'}
                      </Button>
                    </div>

                    {expandedGround === ground.id && (
                      <div className="space-y-2">
                        {loadingPlayers ? (
                          <p className="text-xs text-gray-400">Loading...</p>
                        ) : groundGames.length === 0 ? (
                          <p className="text-xs text-gray-400">No games found on this ground{selectedSport ? ` for ${selectedSport}` : ''}</p>
                        ) : (
                          groundGames.map(game => (
                            <div key={game.game_id} className="p-2 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm">{sportIconChar(game.sport_type)}</span>
                                {game.title && <span className="text-sm font-medium">{game.title}</span>}
                                <Badge className={`${statusColor(game.status)} text-xs`}>{statusLabel(game.status)}</Badge>
                              </div>
                              <p className="text-xs text-gray-500 mb-1">{game.game_date} at {game.game_time}</p>
                              <div className="flex flex-wrap gap-1">
                                {game.players.map(p => (
                                  <Badge key={p.user_id} variant="outline" className="text-xs">
                                    {formatPlayerName(p.name)}{p.position && p.position !== 'Anywhere' ? ` (${p.position})` : ''}
                                    {p.status === 'waiting' && <span className="text-orange-500 ml-1">WL</span>}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
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
