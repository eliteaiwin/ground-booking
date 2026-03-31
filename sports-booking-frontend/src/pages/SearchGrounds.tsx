import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Search, MapPin, Building, Phone, Shield, Users, ChevronDown, ChevronUp, UserPlus, ChevronLeft, ChevronRight } from 'lucide-react';

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
  sport_types: string[];
  moderators: Moderator[];
  is_member?: boolean;
  is_mod_or_admin?: boolean;
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

const GROUNDS_PER_PAGE = 12;
const PLAYERS_PER_PAGE = 10;

const sportIconChar = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  return '\uD83C\uDFC5';
};

const formatPlayerName = (name: string) => (name || '').split(' ')[0];

export default function SearchGrounds({ onBack }: Props) {
  const { user } = useAuth();
  const { activeTheme } = useTheme();
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
  const [currentPage, setCurrentPage] = useState(1);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerPage, setPlayerPage] = useState(1);

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

  const userSports: string[] = user?.sports ? (typeof user.sports === 'string' ? (user.sports as string).split(',').filter(Boolean) : user.sports) : [];

  useEffect(() => {
    api.listLocations().then(setLocations).catch(console.error);
    handleSearch();
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setCurrentPage(1);
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
      setPlayerSearch('');
      setPlayerPage(1);
      return;
    }
    setExpandedGround(groundId);
    setLoadingPlayers(true);
    setPlayerSearch('');
    setPlayerPage(1);
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

  const totalPages = Math.ceil(results.length / GROUNDS_PER_PAGE);
  const paginatedResults = results.slice(
    (currentPage - 1) * GROUNDS_PER_PAGE,
    currentPage * GROUNDS_PER_PAGE
  );

  const allPlayers = useMemo(() => {
    const players: Array<GamePlayer & { game_title: string; sport_type: string; game_date: string }> = [];
    for (const game of groundGames) {
      for (const p of game.players) {
        players.push({ ...p, game_title: game.title, sport_type: game.sport_type, game_date: game.game_date });
      }
    }
    return players;
  }, [groundGames]);

  const filteredPlayers = useMemo(() => {
    if (!playerSearch.trim()) return allPlayers;
    const q = playerSearch.toLowerCase();
    return allPlayers.filter(p => p.name.toLowerCase().includes(q));
  }, [allPlayers, playerSearch]);

  const playerTotalPages = Math.ceil(filteredPlayers.length / PLAYERS_PER_PAGE);
  const paginatedPlayers = filteredPlayers.slice(
    (playerPage - 1) * PLAYERS_PER_PAGE,
    playerPage * PLAYERS_PER_PAGE
  );

  const PaginationControls = ({ page, total, onPageChange }: { page: number; total: number; onPageChange: (p: number) => void }) => {
    if (total <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-2 mt-3">
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={14} />
        </Button>
        <span className="text-xs text-gray-600">Page {page} of {total}</span>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= total} onClick={() => onPageChange(page + 1)}>
          <ChevronRight size={14} />
        </Button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ backgroundColor: activeTheme.header_bg }}>
        <div className="max-w-4xl mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Search size={20} /> Search Grounds
          </h1>
          <p className="text-sm opacity-80 mt-1">Find grounds, moderators & see who is playing</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <div className="flex items-end">
                <Button onClick={handleSearch} disabled={loading} className="w-full" style={{ backgroundColor: activeTheme.button_bg }}>
                  <Search size={16} className="mr-2" />
                  {loading ? 'Searching...' : 'Search'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {searched && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{results.length} ground{results.length !== 1 ? 's' : ''} found</p>
              {totalPages > 1 && (
                <p className="text-xs text-gray-400">Showing {(currentPage - 1) * GROUNDS_PER_PAGE + 1}-{Math.min(currentPage * GROUNDS_PER_PAGE, results.length)} of {results.length}</p>
              )}
            </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginatedResults.map(ground => (
                <Card key={ground.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      {ground.sport_types && ground.sport_types.length > 0 ? (
                        <span className="flex gap-0.5">{ground.sport_types.map(s => <span key={s} title={s}>{sportIconChar(s)}</span>)}</span>
                      ) : (
                        <MapPin size={16} style={{ color: activeTheme.primary_color }} />
                      )}
                      <span className="truncate">{ground.display_name}</span>
                    </CardTitle>
                    {ground.ground_code_display && (
                      <Badge variant="outline" className="text-xs font-mono w-fit">{ground.ground_code_display}</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="p-4 pt-0 flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="text-xs" style={{ backgroundColor: activeTheme.primary_color + '20', color: activeTheme.primary_color }}>{ground.location}</Badge>
                      <Badge variant="outline" className="text-xs">{ground.name}</Badge>
                    </div>
                    {ground.moderators.length > 0 ? (
                      <div className="mb-2">
                        <p className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                          <Shield size={14} className="text-purple-600" /> Moderators ({ground.moderators.length})
                        </p>
                        <div className="space-y-1">
                          {ground.moderators.slice(0, 2).map((mod, idx) => (
                            <div key={mod.user_id + '-' + idx} className="flex items-center gap-2 p-1.5 bg-purple-50 rounded text-xs">
                              <Shield size={10} className="text-purple-600 shrink-0" />
                              <span className="font-medium truncate">{mod.name}</span>
                              <a href={'tel:' + mod.phone} className="ml-auto text-blue-600 hover:underline shrink-0">
                                <Phone size={10} />
                              </a>
                            </div>
                          ))}
                          {ground.moderators.length > 2 && (
                            <p className="text-xs text-gray-400">+{ground.moderators.length - 2} more</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-2">No moderators assigned yet</p>
                    )}
                    {ground.moderators.length > 0 && !ground.is_member && !ground.is_mod_or_admin && (
                    <div className="border-t pt-2 mt-auto">
                      {joinGroundId === ground.id ? (
                        <div className="space-y-2 mb-2">
                          <Label className="text-xs">Your Sport Interests</Label>
                          <Input className="h-7 text-xs" placeholder="e.g. Soccer, Cricket" value={joinSports} onChange={e => setJoinSports(e.target.value)} />
                          <Label className="text-xs">Message (optional)</Label>
                          <Textarea placeholder="Hi, I'd like to join..." value={joinMessage} onChange={e => setJoinMessage(e.target.value)} rows={2} className="text-xs" />
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" style={{ backgroundColor: activeTheme.button_bg }} disabled={joinLoading} onClick={() => handleJoinRequest(ground.id)}>
                              {joinLoading ? 'Submitting...' : 'Submit'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setJoinGroundId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setJoinGroundId(ground.id)}>
                          <UserPlus size={12} className="mr-1" /> Request to Join
                        </Button>
                      )}
                    </div>
                    )}
                    <div className="border-t pt-2 mt-auto">
                      <div className="flex items-center gap-1 mb-1 flex-wrap">
                        {userSports.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {userSports.map(s => (
                              <button key={s}
                                onClick={() => { setSelectedSport(s); handleViewPlayers(ground.id, s); }}
                                className={'text-xs px-1.5 py-0.5 rounded-full border ' + (selectedSport === s && expandedGround === ground.id ? 'border-current' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100')}
                                style={selectedSport === s && expandedGround === ground.id ? { backgroundColor: activeTheme.primary_color + '15', color: activeTheme.primary_color, borderColor: activeTheme.primary_color } : undefined}>
                                {sportIconChar(s)} {s.charAt(0).toUpperCase() + s.slice(1)}
                              </button>
                            ))}
                          </div>
                        )}
                        <Button size="sm" variant="outline" className="ml-auto text-xs h-6 px-2" onClick={() => handleViewPlayers(ground.id)}>
                          <Users size={12} className="mr-1" />
                          {expandedGround === ground.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {expandedGround === ground.id ? ' Hide' : ' Players'}
                        </Button>
                      </div>
                      {expandedGround === ground.id && (
                        <div className="space-y-2 mt-2">
                          {loadingPlayers ? (
                            <p className="text-xs text-gray-400">Loading...</p>
                          ) : groundGames.length === 0 ? (
                            <p className="text-xs text-gray-400">No games found{selectedSport ? ' for ' + selectedSport : ''}</p>
                          ) : (
                            <>
                              {allPlayers.length > 0 && (
                                <div className="relative">
                                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                  <Input className="h-7 text-xs pl-7" placeholder="Search players..." value={playerSearch} onChange={e => { setPlayerSearch(e.target.value); setPlayerPage(1); }} />
                                </div>
                              )}
                              {filteredPlayers.length === 0 ? (
                                <p className="text-xs text-gray-400">No players match &quot;{playerSearch}&quot;</p>
                              ) : (
                                <>
                                  <div className="text-xs text-gray-400">{filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''}</div>
                                  <div className="flex flex-wrap gap-1">
                                    {paginatedPlayers.map((p, idx) => (
                                      <Badge key={p.user_id + '-' + idx} variant="outline" className="text-xs">
                                        {formatPlayerName(p.name)}{p.position && p.position !== 'Anywhere' ? ' (' + p.position + ')' : ''}
                                        {p.status === 'waiting' && <span className="text-orange-500 ml-1">WL</span>}
                                        <span className="ml-1 text-gray-400">{sportIconChar(p.sport_type)}</span>
                                      </Badge>
                                    ))}
                                  </div>
                                  <PaginationControls page={playerPage} total={playerTotalPages} onPageChange={setPlayerPage} />
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <PaginationControls page={currentPage} total={totalPages} onPageChange={setCurrentPage} />
          </div>
        )}
      </div>
    </div>
  );
}
