import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Shield, MapPin, Users, Trash2, Building, Plus, Search, Phone, Edit2 } from 'lucide-react';

interface UserItem {
  id: number;
  name: string;
  phone: string;
  roles: string[];
}

interface Location {
  id: number;
  name: string;
}

interface Ground {
  id: number;
  name: string;
  location: string;
  display_name: string;
  is_approved?: number;
}

interface ModeratorAssignment {
  id: number;
  user_id: number;
  user_name: string;
  user_phone: string;
  location: string;
  ground_name: string;
  sport_type: string;
}

const SPORTS = ['soccer', 'cricket', 'badminton', 'basketball', 'hockey'];

interface Props {
  onBack: () => void;
}

export default function AdminScreens({ onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'locations' | 'grounds' | 'assign' | 'search-user'>('locations');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [assignments, setAssignments] = useState<ModeratorAssignment[]>([]);

  // Location creation
  const [newLocationName, setNewLocationName] = useState('');

  // Ground creation
  const [newGroundName, setNewGroundName] = useState('');
  const [groundLocation, setGroundLocation] = useState('');

  // Assign moderator
  const [assignUserId, setAssignUserId] = useState('');
  const [assignLocation, setAssignLocation] = useState('');
  const [assignGround, setAssignGround] = useState('');
  const [assignSport, setAssignSport] = useState('');

  // Search user
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedUser, setSearchedUser] = useState<UserItem | null>(null);
  const [userAssignments, setUserAssignments] = useState<ModeratorAssignment[]>([]);
  const [newAssignLocation, setNewAssignLocation] = useState('');
  const [newAssignGround, setNewAssignGround] = useState('');
  const [newAssignSport, setNewAssignSport] = useState('');

  // Rename state
  const [renamingLocId, setRenamingLocId] = useState<number | null>(null);
  const [renameLocName, setRenameLocName] = useState('');
  const [renamingGroundId, setRenamingGroundId] = useState<number | null>(null);
  const [renameGroundName, setRenameGroundName] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [usersData, locsData, grndsData, assignData] = await Promise.all([
        api.listUsers(),
        api.listLocations(),
        api.listGrounds(),
        api.listModeratorAssignments(),
      ]);
      setUsers(usersData);
      setLocations(locsData);
      setGrounds(grndsData);
      setAssignments(assignData);
    } catch (err) {
      console.error(err);
    }
  };

  const showMsg = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccess(''); }
    else { setSuccess(msg); setError(''); }
    setTimeout(() => { setSuccess(''); setError(''); }, 3000);
  };

  // --- Create Location ---
  const handleAddLocation = async () => {
    if (!newLocationName.trim()) return;
    setLoading(true);
    try {
      await api.addLocation(newLocationName.trim());
      setNewLocationName('');
      showMsg('Location added successfully!');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed to add location', true);
    } finally {
      setLoading(false);
    }
  };

  // --- Rename Location ---
  const handleRenameLocation = async (locId: number) => {
    if (!renameLocName.trim()) return;
    setLoading(true);
    try {
      await api.renameLocation(locId, renameLocName.trim());
      setRenamingLocId(null);
      setRenameLocName('');
      showMsg('Location renamed successfully!');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed to rename location', true);
    } finally {
      setLoading(false);
    }
  };

  // --- Create Ground ---
  const handleAddGround = async () => {
    if (!newGroundName.trim() || !groundLocation) return;
    setLoading(true);
    try {
      await api.addGround(newGroundName.trim(), groundLocation);
      setNewGroundName('');
      showMsg('Ground added successfully!');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed to add ground', true);
    } finally {
      setLoading(false);
    }
  };

  // --- Rename Ground ---
  const handleRenameGround = async (groundId: number) => {
    if (!renameGroundName.trim()) return;
    setLoading(true);
    try {
      await api.renameGround(groundId, renameGroundName.trim());
      setRenamingGroundId(null);
      setRenameGroundName('');
      showMsg('Ground renamed successfully!');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed to rename ground', true);
    } finally {
      setLoading(false);
    }
  };

  // --- Delete Ground ---
  const handleDeleteGround = async (groundId: number) => {
    if (!confirm('Are you sure you want to delete this ground? This can only be done if no games have been played on it.')) return;
    setLoading(true);
    try {
      await api.deleteGround(groundId);
      showMsg('Ground deleted successfully!');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed to delete ground', true);
    } finally {
      setLoading(false);
    }
  };

  // --- Assign moderator ---
  const handleAssignModerator = async () => {
    if (!assignUserId || !assignLocation) return;
    setLoading(true);
    try {
      await api.assignModeratorLocation(Number(assignUserId), assignLocation, assignGround, assignSport);
      showMsg('Moderator assigned successfully!');
      setAssignUserId('');
      setAssignLocation('');
      setAssignGround('');
      setAssignSport('');
      await loadData();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed', true);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAssignment = async (id: number) => {
    try {
      await api.removeModeratorAssignment(id);
      await loadData();
      // Refresh searched user assignments if applicable
      if (searchedUser) {
        const allAssign = await api.listModeratorAssignments();
        setUserAssignments(allAssign.filter((a: ModeratorAssignment) => a.user_id === searchedUser.id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Search user ---
  const handleSearchUser = () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const found = users.find(
      u => u.name.toLowerCase().includes(q) || u.phone.includes(q)
    );
    if (found) {
      setSearchedUser(found);
      setUserAssignments(assignments.filter(a => a.user_id === found.id));
      setError('');
    } else {
      setSearchedUser(null);
      setUserAssignments([]);
      showMsg('No user found matching that query', true);
    }
  };

  const handleAssignToSearchedUser = async () => {
    if (!searchedUser || !newAssignLocation) return;
    setLoading(true);
    try {
      await api.assignModeratorLocation(searchedUser.id, newAssignLocation, newAssignGround, newAssignSport);
      showMsg(`Moderator permission added for ${searchedUser.name}!`);
      setNewAssignLocation('');
      setNewAssignGround('');
      setNewAssignSport('');
      await loadData();
      // Refresh user assignments
      const allAssign = await api.listModeratorAssignments();
      setAssignments(allAssign);
      setUserAssignments(allAssign.filter((a: ModeratorAssignment) => a.user_id === searchedUser.id));
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Failed', true);
    } finally {
      setLoading(false);
    }
  };

  const assignGroundsForLocation = assignLocation
    ? grounds.filter(g => g.location === assignLocation)
    : [];

  const newAssignGroundsForLocation = newAssignLocation
    ? grounds.filter(g => g.location === newAssignLocation)
    : [];

  const groundsForGroundLocation = groundLocation
    ? grounds.filter(g => g.location === groundLocation)
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <p className="text-sm text-purple-200 mt-1">Full control over locations, grounds & moderators</p>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {success && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">{success}</div>}
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={activeTab === 'locations' ? 'default' : 'outline'}
            onClick={() => setActiveTab('locations')}
            className={activeTab === 'locations' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            size="sm"
          >
            <MapPin size={14} className="mr-1" /> Locations
          </Button>
          <Button
            variant={activeTab === 'grounds' ? 'default' : 'outline'}
            onClick={() => setActiveTab('grounds')}
            className={activeTab === 'grounds' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            size="sm"
          >
            <Building size={14} className="mr-1" /> Grounds
          </Button>
          <Button
            variant={activeTab === 'assign' ? 'default' : 'outline'}
            onClick={() => setActiveTab('assign')}
            className={activeTab === 'assign' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            size="sm"
          >
            <Shield size={14} className="mr-1" /> Assign
          </Button>
          <Button
            variant={activeTab === 'search-user' ? 'default' : 'outline'}
            onClick={() => setActiveTab('search-user')}
            className={activeTab === 'search-user' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            size="sm"
          >
            <Search size={14} className="mr-1" /> Search User
          </Button>
        </div>

        {/* ===== LOCATIONS TAB ===== */}
        {activeTab === 'locations' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus size={16} /> Create Location</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Location Name</Label>
                  <Input placeholder="e.g. Mumbai" value={newLocationName} onChange={e => setNewLocationName(e.target.value)} />
                </div>
                <Button onClick={handleAddLocation} disabled={loading || !newLocationName.trim()}
                  className="w-full bg-purple-600 hover:bg-purple-700">
                  {loading ? 'Adding...' : 'Add Location'}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Existing Locations ({locations.length})</CardTitle></CardHeader>
              <CardContent>
                {locations.length === 0 ? (
                  <p className="text-sm text-gray-400">No locations yet</p>
                ) : (
                  <div className="space-y-2">
                    {locations.map(loc => (
                      <div key={loc.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <MapPin size={14} className="text-purple-600" />
                        {renamingLocId === loc.id ? (
                          <div className="flex-1 flex gap-2">
                            <Input className="h-8 text-sm" value={renameLocName} onChange={e => setRenameLocName(e.target.value)} />
                            <Button size="sm" className="h-8 bg-purple-600 hover:bg-purple-700" onClick={() => handleRenameLocation(loc.id)} disabled={loading}>Save</Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => setRenamingLocId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-medium flex-1">{loc.name}</span>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-purple-600"
                              onClick={() => { setRenamingLocId(loc.id); setRenameLocName(loc.name); }}>
                              <Edit2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ===== GROUNDS TAB ===== */}
        {activeTab === 'grounds' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus size={16} /> Create Ground</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select value={groundLocation} onValueChange={setGroundLocation}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ground Name</Label>
                  <Input placeholder="e.g. Whitefield United" value={newGroundName} onChange={e => setNewGroundName(e.target.value)} />
                </div>
                <Button onClick={handleAddGround} disabled={loading || !newGroundName.trim() || !groundLocation}
                  className="w-full bg-purple-600 hover:bg-purple-700">
                  {loading ? 'Adding...' : 'Add Ground'}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Existing Grounds ({grounds.length})</CardTitle></CardHeader>
              <CardContent>
                {groundsForGroundLocation.length === 0 && !groundLocation ? (
                  <div className="space-y-2">
                    {grounds.length === 0 ? (
                      <p className="text-sm text-gray-400">No grounds yet</p>
                    ) : (
                      grounds.map(g => (
                        <div key={g.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                          <Building size={14} className="text-purple-600" />
                          {renamingGroundId === g.id ? (
                            <div className="flex-1 flex gap-2">
                              <Input className="h-8 text-sm" value={renameGroundName} onChange={e => setRenameGroundName(e.target.value)} />
                              <Button size="sm" className="h-8 bg-purple-600 hover:bg-purple-700" onClick={() => handleRenameGround(g.id)} disabled={loading}>Save</Button>
                              <Button size="sm" variant="outline" className="h-8" onClick={() => setRenamingGroundId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-medium flex-1">{g.display_name}</span>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-purple-600"
                                onClick={() => { setRenamingGroundId(g.id); setRenameGroundName(g.name); }}>
                                <Edit2 size={14} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                                onClick={() => handleDeleteGround(g.id)}>
                                <Trash2 size={14} />
                              </Button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groundsForGroundLocation.map(g => (
                      <div key={g.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <Building size={14} className="text-purple-600" />
                        {renamingGroundId === g.id ? (
                          <div className="flex-1 flex gap-2">
                            <Input className="h-8 text-sm" value={renameGroundName} onChange={e => setRenameGroundName(e.target.value)} />
                            <Button size="sm" className="h-8 bg-purple-600 hover:bg-purple-700" onClick={() => handleRenameGround(g.id)} disabled={loading}>Save</Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => setRenamingGroundId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-medium flex-1">{g.display_name}</span>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-purple-600"
                              onClick={() => { setRenamingGroundId(g.id); setRenameGroundName(g.name); }}>
                              <Edit2 size={14} />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                              onClick={() => handleDeleteGround(g.id)}>
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                    {groundsForGroundLocation.length === 0 && (
                      <p className="text-sm text-gray-400">No grounds for this location</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ===== ASSIGN TAB ===== */}
        {activeTab === 'assign' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield size={16} /> Assign Moderator to Location</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Select User</Label>
                  <Select value={assignUserId} onValueChange={setAssignUserId}>
                    <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.phone})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select value={assignLocation} onValueChange={(val) => { setAssignLocation(val); setAssignGround(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {assignGroundsForLocation.length > 0 && (
                  <div className="space-y-2">
                    <Label>Ground (optional)</Label>
                    <Select value={assignGround} onValueChange={setAssignGround}>
                      <SelectTrigger><SelectValue placeholder="All grounds" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Grounds</SelectItem>
                        {assignGroundsForLocation.map(g => (
                          <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Sport (optional)</Label>
                  <Select value={assignSport} onValueChange={setAssignSport}>
                    <SelectTrigger><SelectValue placeholder="All sports" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sports</SelectItem>
                      {SPORTS.map(s => (
                        <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleAssignModerator} disabled={loading || !assignUserId || !assignLocation}
                  className="w-full bg-purple-600 hover:bg-purple-700">
                  {loading ? 'Assigning...' : 'Assign as Moderator'}
                </Button>
              </CardContent>
            </Card>

            {/* All Assignments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users size={16} /> All Moderator Assignments ({assignments.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-sm text-gray-400">No assignments yet</p>
                ) : (
                  <div className="space-y-2">
                    {assignments.map(a => (
                      <div key={a.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm font-medium">{a.user_name}</p>
                          <p className="text-xs text-gray-500">
                            {a.location}{a.ground_name ? ` - ${a.ground_name}` : ' (All Grounds)'}
                            {a.sport_type ? ` (${a.sport_type.charAt(0).toUpperCase() + a.sport_type.slice(1)})` : ' (All Sports)'}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">{a.user_phone}</Badge>
                        <Button size="sm" variant="ghost" className="text-red-500 h-8 w-8 p-0"
                          onClick={() => handleRemoveAssignment(a.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ===== SEARCH USER TAB ===== */}
        {activeTab === 'search-user' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search size={16} /> Search User</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Search by Name or Phone</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. Alex or 9876..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchUser()}
                    />
                    <Button onClick={handleSearchUser} className="bg-purple-600 hover:bg-purple-700">
                      <Search size={16} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {searchedUser && (
              <>
                <Card className="border-purple-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users size={16} /> {searchedUser.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone size={14} /> {searchedUser.phone}
                    </div>
                    <div className="flex gap-1">
                      {searchedUser.roles.map(role => (
                        <Badge key={role} className={`text-xs capitalize ${
                          role === 'admin' ? 'bg-red-100 text-red-700' :
                          role === 'moderator' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>{role}</Badge>
                      ))}
                    </div>

                    {/* Current assignments */}
                    <div className="mt-3">
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        Current Moderator Assignments ({userAssignments.length}):
                      </p>
                      {userAssignments.length === 0 ? (
                        <p className="text-xs text-gray-400">No moderator assignments for this user</p>
                      ) : (
                        <div className="space-y-2">
                          {userAssignments.map(a => (
                            <div key={a.id} className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
                              <div className="flex-1">
                                <p className="text-sm">
                                  {a.location}{a.ground_name ? ` - ${a.ground_name}` : ' (All Grounds)'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {a.sport_type ? a.sport_type.charAt(0).toUpperCase() + a.sport_type.slice(1) : 'All Sports'}
                                </p>
                              </div>
                              <Button size="sm" variant="ghost" className="text-red-500 h-8 w-8 p-0"
                                onClick={() => handleRemoveAssignment(a.id)}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Add new assignment for this user */}
                <Card className="border-green-200 bg-green-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Plus size={16} /> Add New Moderator Permission for {searchedUser.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Select value={newAssignLocation} onValueChange={(val) => { setNewAssignLocation(val); setNewAssignGround(''); }}>
                        <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                        <SelectContent>
                          {locations.map(loc => (
                            <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {newAssignGroundsForLocation.length > 0 && (
                      <div className="space-y-2">
                        <Label>Ground (optional)</Label>
                        <Select value={newAssignGround} onValueChange={setNewAssignGround}>
                          <SelectTrigger><SelectValue placeholder="All grounds" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Grounds</SelectItem>
                            {newAssignGroundsForLocation.map(g => (
                              <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Sport (optional)</Label>
                      <Select value={newAssignSport} onValueChange={setNewAssignSport}>
                        <SelectTrigger><SelectValue placeholder="All sports" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sports</SelectItem>
                          {SPORTS.map(s => (
                            <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleAssignToSearchedUser} disabled={loading || !newAssignLocation}
                      className="w-full bg-green-600 hover:bg-green-700">
                      {loading ? 'Assigning...' : 'Add Moderator Permission'}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
