import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, MapPin, Building, Plus, Edit2 } from 'lucide-react';

interface Location {
  id: number;
  name: string;
  created_at: string;
}

interface Ground {
  id: number;
  name: string;
  location: string;
  display_name: string;
  is_approved: number;
  created_at: string;
}

interface Props {
  onBack: () => void;
}

export default function ModeratorScreens({ onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'locations' | 'grounds'>('locations');
  const [locations, setLocations] = useState<Location[]>([]);
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [newGroundName, setNewGroundName] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
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
      const [locs, grnds] = await Promise.all([
        api.listLocations(),
        api.listGrounds(),
      ]);
      setLocations(locs);
      setGrounds(grnds);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.addLocation(newLocationName.trim());
      setNewLocationName('');
      setSuccess('Location added successfully!');
      await loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add location');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGround = async () => {
    if (!newGroundName.trim() || !selectedLocation) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.addGround(newGroundName.trim(), selectedLocation);
      setNewGroundName('');
      setSuccess('Ground added successfully!');
      await loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add ground');
    } finally {
      setLoading(false);
    }
  };

  const handleRenameGround = async (groundId: number) => {
    if (!renameGroundName.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.renameGround(groundId, renameGroundName.trim());
      setRenamingGroundId(null);
      setRenameGroundName('');
      setSuccess('Ground renamed successfully!');
      await loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rename ground');
    } finally {
      setLoading(false);
    }
  };

  const filteredGrounds = filterLocation
    ? grounds.filter(g => g.location === filterLocation)
    : grounds;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-teal-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold">Moderator Screens</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {success && <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">{success}</div>}
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">{error}</div>}

        <div className="flex gap-2">
          <Button
            variant={activeTab === 'locations' ? 'default' : 'outline'}
            onClick={() => setActiveTab('locations')}
            className={activeTab === 'locations' ? 'bg-teal-600 hover:bg-teal-700' : ''}
          >
            <MapPin size={16} className="mr-1" /> Locations
          </Button>
          <Button
            variant={activeTab === 'grounds' ? 'default' : 'outline'}
            onClick={() => setActiveTab('grounds')}
            className={activeTab === 'grounds' ? 'bg-teal-600 hover:bg-teal-700' : ''}
          >
            <Building size={16} className="mr-1" /> Grounds
          </Button>
        </div>

        {activeTab === 'locations' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus size={16} /> Add New Location</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Location Name</Label>
                  <Input placeholder="e.g. Mumbai" value={newLocationName} onChange={e => setNewLocationName(e.target.value)} />
                </div>
                <Button onClick={handleAddLocation} disabled={loading || !newLocationName.trim()}
                  className="w-full bg-teal-600 hover:bg-teal-700">
                  {loading ? 'Adding...' : 'Add Location'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Existing Locations ({locations.length})</CardTitle></CardHeader>
              <CardContent>
                {locations.length === 0 ? (
                  <p className="text-sm text-gray-400">No locations added yet</p>
                ) : (
                  <div className="space-y-2">
                    {locations.map(loc => (
                      <div key={loc.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <MapPin size={14} className="text-teal-600" />
                        <span className="text-sm font-medium flex-1">{loc.name}</span>
                        <span className="text-xs text-gray-400">{new Date(loc.created_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === 'grounds' && (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus size={16} /> Add New Ground</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
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
                <Button onClick={handleAddGround} disabled={loading || !newGroundName.trim() || !selectedLocation}
                  className="w-full bg-teal-600 hover:bg-teal-700">
                  {loading ? 'Adding...' : 'Add Ground'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Existing Grounds ({filteredGrounds.length})</CardTitle>
                  <Select value={filterLocation} onValueChange={setFilterLocation}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Filter by location" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {filteredGrounds.length === 0 ? (
                  <p className="text-sm text-gray-400">No grounds added yet</p>
                ) : (
                  <div className="space-y-2">
                    {filteredGrounds.map(g => (
                      <div key={g.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <Building size={14} className="text-teal-600" />
                        {renamingGroundId === g.id ? (
                          <div className="flex-1 flex gap-2">
                            <Input className="h-8 text-sm" value={renameGroundName} onChange={e => setRenameGroundName(e.target.value)} />
                            <Button size="sm" className="h-8 bg-teal-600 hover:bg-teal-700" onClick={() => handleRenameGround(g.id)} disabled={loading}>Save</Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => setRenamingGroundId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1">
                              <span className="text-sm font-medium">{g.display_name}</span>
                            </div>
                            {g.is_approved ? (
                              <Badge className="bg-green-100 text-green-700 text-xs">Approved</Badge>
                            ) : (
                              <Badge variant="outline" className="text-orange-600 text-xs">Pending</Badge>
                            )}
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-teal-600"
                              onClick={() => { setRenamingGroundId(g.id); setRenameGroundName(g.name); }}>
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
      </div>
    </div>
  );
}
