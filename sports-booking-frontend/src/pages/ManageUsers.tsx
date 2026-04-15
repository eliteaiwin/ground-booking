import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Shield, Users, Search, Edit2, Key, X, Plus, Trash2, Lock, Ban, CheckCircle } from 'lucide-react';

interface GroundItem {
  id: number;
  name: string;
  location: string;
}

interface ModAssignment {
  id: number;
  location: string;
  ground_name: string;
  ground_id: number | null;
  sport_type: string;
}

interface GMAssignment {
  id: number;
  ground_id: number;
  ground_name: string;
  location: string;
}

interface UserItem {
  id: number;
  user_code: string;
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  notification_preference: string;
  roles: string[];
  sports: string[];
  locations: string[];
  sport_positions: Record<string, string[]>;
  profile_pic: string;
  is_super_admin: boolean;
  is_disabled: boolean;
  disabled_reason: string;
  moderator_assignments: ModAssignment[];
  ground_management_assignments: GMAssignment[];
  created_at: string;
}

interface Props {
  onBack: () => void;
}

const ALL_SPORTS = ['soccer', 'cricket', 'badminton', 'basketball', 'hockey'];

export default function ManageUsers({ onBack }: Props) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [grounds, setGrounds] = useState<GroundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterGround, setFilterGround] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterSport, setFilterSport] = useState('');

  // Edit modal state
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    notification_preference: 'whatsapp', sports: [] as string[], locations: [] as string[],
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Reset password state
  const [resetPwUser, setResetPwUser] = useState<UserItem | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  // Disable/Enable state
  const [disableUser, setDisableUser] = useState<UserItem | null>(null);
  const [disableReason, setDisableReason] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  // Ground role assignment state
  const [roleUser, setRoleUser] = useState<UserItem | null>(null);
  const [selectedGround, setSelectedGround] = useState('');
  const [selectedRole, setSelectedRole] = useState('moderator');
  const [selectedSportType, setSelectedSportType] = useState('');
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const filters: Record<string, string | number> = {};
      if (searchText) filters.search = searchText;
      if (filterLocation) filters.location = filterLocation;
      if (filterGround) filters.ground_id = parseInt(filterGround);
      if (filterRole) filters.role = filterRole;
      if (filterSport) filters.sport = filterSport;
      const data = await api.searchUsers(filters);
      setUsers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    api.listGrounds().then(setGrounds).catch(() => {});
  }, []);

  const handleSearch = () => fetchUsers();

  const openEdit = (user: UserItem) => {
    setEditUser(user);
    setEditForm({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email || '',
      phone: user.phone,
      notification_preference: user.notification_preference,
      sports: [...user.sports],
      locations: [...user.locations],
    });
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setEditLoading(true);
    setEditError('');
    try {
      await api.adminUpdateUser(editUser.id, {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        email: editForm.email || undefined,
        phone: editForm.phone,
        notification_preference: editForm.notification_preference,
        sports: editForm.sports,
        locations: editForm.locations,
      });
      setEditUser(null);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user';
      setEditError(msg);
    } finally {
      setEditLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwUser) return;
    setResetLoading(true);
    setResetError('');
    setResetSuccess('');
    try {
      await api.adminResetPassword(resetPwUser.id, {
        new_password: newPassword,
        force_change: forceChange,
      });
      setResetSuccess('Password reset successfully' + (forceChange ? '. User must change on next login.' : '.'));
      setNewPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset password';
      setResetError(msg);
    } finally {
      setResetLoading(false);
    }
  };

  const toggleRole = async (user: UserItem, role: string) => {
    const hasRole = user.roles.includes(role);
    let newRoles: string[];
    if (hasRole) {
      newRoles = user.roles.filter(r => r !== role);
      if (newRoles.length === 0) newRoles = ['user'];
    } else {
      newRoles = [...user.roles, role];
    }
    try {
      await api.updateUserRoles(user.id, newRoles);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update roles';
      alert(msg);
    }
  };

  const assignGroundRole = async () => {
    if (!roleUser || !selectedGround) return;
    setRoleLoading(true);
    setRoleError('');
    try {
      await api.assignGroundRole(roleUser.id, {
        ground_id: parseInt(selectedGround),
        role: selectedRole,
        sport_type: selectedSportType || undefined,
      });
      fetchUsers();
      const updatedUsers = await api.searchUsers({ search: roleUser.phone });
      const updated = updatedUsers.find((u: UserItem) => u.id === roleUser.id);
      if (updated) setRoleUser(updated);
      setSelectedGround('');
      setSelectedSportType('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign role';
      setRoleError(msg);
    } finally {
      setRoleLoading(false);
    }
  };

  const removeAssignment = async (userId: number, type: string, assignmentId: number) => {
    try {
      await api.removeGroundRole(userId, type, assignmentId);
      fetchUsers();
      if (roleUser && roleUser.id === userId) {
        const updatedUsers = await api.searchUsers({ search: roleUser.phone });
        const updated = updatedUsers.find((u: UserItem) => u.id === userId);
        if (updated) setRoleUser(updated);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove assignment';
      alert(msg);
    }
  };

  const handleDisableUser = async (user: UserItem) => {
    setDisableLoading(true);
    try {
      await api.disableUser(user.id, disableReason);
      setDisableUser(null);
      setDisableReason('');
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to disable user';
      alert(msg);
    } finally {
      setDisableLoading(false);
    }
  };

  const handleEnableUser = async (user: UserItem) => {
    try {
      await api.enableUser(user.id);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to enable user';
      alert(msg);
    }
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700';
      case 'moderator': return 'bg-blue-100 text-blue-700';
      case 'ground_management': return 'bg-purple-100 text-purple-700';
      case 'user': return 'bg-gray-100 text-gray-700';
      case 'readonly': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const allLocations = Array.from(new Set(users.flatMap(u => u.locations)));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users size={20} /> Admin User Management
          </h1>
        </div>
      </header>

      {/* Search Filters */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Search (Name/Phone/Email)</label>
                <input
                  type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  placeholder="Search..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="">All Locations</option>
                  {allLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Ground</label>
                <select value={filterGround} onChange={e => setFilterGround(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="">All Grounds</option>
                  {grounds.map(g => <option key={g.id} value={g.id}>{g.location} - {g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="moderator">Moderator</option>
                  <option value="ground_management">Ground Manager</option>
                  <option value="user">User</option>
                  <option value="readonly">Read Only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sport</label>
                <select value={filterSport} onChange={e => setFilterSport(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="">All Sports</option>
                  {ALL_SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleSearch} className="w-full" size="sm">
                  <Search size={14} className="mr-1" /> Search
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Grid */}
      <div className="max-w-4xl mx-auto px-4 pb-8">
        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : users.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-gray-500">No users found</CardContent></Card>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">{users.length} user(s) found</p>
            <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 bg-gray-200 rounded-t text-xs font-semibold text-gray-600">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-2">Email</div>
              <div className="col-span-1">Location</div>
              <div className="col-span-2">Roles</div>
              <div className="col-span-2">Actions</div>
            </div>
            {users.map(u => (
              <Card key={u.id} className="md:rounded-none md:border-x md:border-b">
                <CardContent className="p-3">
                  <div className="md:grid md:grid-cols-12 md:gap-2 md:items-center">
                    <div className="col-span-3">
                      <div className="font-semibold text-sm text-gray-800">
                        {u.first_name} {u.last_name}
                        {u.is_super_admin && <span title="Protected Admin"><Lock size={12} className="inline ml-1 text-red-500" /></span>}
                        {u.is_disabled && <Badge className="ml-1 bg-red-500 text-white text-[9px] px-1">Disabled</Badge>}
                      </div>
                      <div className="text-xs text-gray-400">{u.user_code}</div>
                      {u.is_disabled && u.disabled_reason && (
                        <div className="text-[10px] text-red-500 italic">Reason: {u.disabled_reason}</div>
                      )}
                    </div>
                    <div className="col-span-2 text-sm text-gray-600">{u.phone}</div>
                    <div className="col-span-2 text-sm text-gray-600 truncate">{u.email || '-'}</div>
                    <div className="col-span-1 text-xs text-gray-500">{u.locations.join(', ') || '-'}</div>
                    <div className="col-span-2 flex flex-wrap gap-1">
                      {u.roles.map(role => (
                        <Badge key={role} className={`${roleColor(role)} text-[10px] capitalize`}>
                          {role.replace('_', ' ')}
                        </Badge>
                      ))}
                    </div>
                    <div className="col-span-2 flex gap-1 mt-2 md:mt-0">
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                        onClick={() => openEdit(u)} title="Edit User">
                        <Edit2 size={12} />
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                        onClick={() => {
                          setResetPwUser(u);
                          setNewPassword('');
                          setForceChange(true);
                          setResetError('');
                          setResetSuccess('');
                        }}
                        title="Reset Password">
                        <Key size={12} />
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                        onClick={() => setRoleUser(u)} title="Ground Roles">
                        <Shield size={12} />
                      </Button>
                      {!u.is_super_admin && (
                        u.is_disabled ? (
                          <Button size="sm" variant="outline" className="text-xs h-7 px-2 text-green-600 border-green-300 hover:bg-green-50"
                            onClick={() => handleEnableUser(u)} title="Enable User">
                            <CheckCircle size={12} />
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="text-xs h-7 px-2 text-red-600 border-red-300 hover:bg-red-50"
                            onClick={() => { setDisableUser(u); setDisableReason(''); }} title="Disable User">
                            <Ban size={12} />
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                  <div className="md:hidden mt-2 flex flex-wrap gap-1">
                    {['admin', 'moderator', 'ground_management', 'user'].map(role => (
                      <Button key={role} size="sm"
                        variant={u.roles.includes(role) ? 'default' : 'outline'}
                        className={`text-[10px] h-6 px-2 ${u.roles.includes(role)
                          ? (role === 'admin' ? 'bg-red-600' : role === 'moderator' ? 'bg-blue-600' : 'bg-purple-600')
                          : ''}`}
                        onClick={() => toggleRole(u, role)}
                        disabled={u.is_super_admin && role === 'admin'}>
                        {role.replace('_', ' ')}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-bold text-lg">Edit User: {editUser.first_name} {editUser.last_name}</h3>
              <button onClick={() => setEditUser(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                  <input type="text" value={editForm.first_name}
                    onChange={e => setEditForm({ ...editForm, first_name: e.target.value })}
                    className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input type="text" value={editForm.last_name}
                    onChange={e => setEditForm({ ...editForm, last_name: e.target.value })}
                    className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={editForm.email}
                  onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="text" value={editForm.phone}
                  onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notification Preference</label>
                <select value={editForm.notification_preference}
                  onChange={e => setEditForm({ ...editForm, notification_preference: e.target.value })}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sports</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SPORTS.map(s => (
                    <label key={s} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={editForm.sports.includes(s)}
                        onChange={e => {
                          if (e.target.checked) setEditForm({ ...editForm, sports: [...editForm.sports, s] });
                          else setEditForm({ ...editForm, sports: editForm.sports.filter(sp => sp !== s) });
                        }} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Locations</label>
                <input type="text" value={editForm.locations.join(',')}
                  onChange={e => setEditForm({
                    ...editForm,
                    locations: e.target.value.split(',').map(l => l.trim()).filter(Boolean),
                  })}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  placeholder="Comma-separated locations" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Global Roles</label>
                <div className="flex flex-wrap gap-2">
                  {['admin', 'moderator', 'ground_management', 'user', 'readonly'].map(role => (
                    <Button key={role} size="sm"
                      variant={editUser.roles.includes(role) ? 'default' : 'outline'}
                      className={`text-xs h-7 ${editUser.roles.includes(role)
                        ? (role === 'admin' ? 'bg-red-600 hover:bg-red-700'
                          : role === 'moderator' ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-purple-600 hover:bg-purple-700')
                        : ''}`}
                      onClick={() => toggleRole(editUser, role)}
                      disabled={editUser.is_super_admin && role === 'admin'}>
                      {role.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
                {editUser.is_super_admin && (
                  <p className="text-xs text-red-500 mt-1">Admin role is protected for this account</p>
                )}
              </div>
              {editError && <p className="text-red-500 text-sm">{editError}</p>}
              <div className="flex gap-2">
                <Button onClick={saveEdit} disabled={editLoading} className="flex-1">
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button onClick={() => setEditUser(null)} variant="outline" className="flex-1">Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPwUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="border-b p-4 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-bold">Reset Password: {resetPwUser.first_name}</h3>
              <button onClick={() => setResetPwUser(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                <input type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  placeholder="Min 6 characters" minLength={6} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={forceChange}
                  onChange={e => setForceChange(e.target.checked)} />
                <span>Force change password on next login</span>
              </label>
              {resetError && <p className="text-red-500 text-sm">{resetError}</p>}
              {resetSuccess && <p className="text-green-600 text-sm">{resetSuccess}</p>}
              <Button onClick={handleResetPassword}
                disabled={resetLoading || newPassword.length < 6} className="w-full">
                {resetLoading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Ground Role Assignment Modal */}
      {roleUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-bold">Ground Roles: {roleUser.first_name} {roleUser.last_name}</h3>
              <button onClick={() => setRoleUser(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-blue-700 mb-2">Moderator Assignments</h4>
                {roleUser.moderator_assignments.length === 0 ? (
                  <p className="text-xs text-gray-400">No moderator assignments</p>
                ) : (
                  <div className="space-y-1">
                    {roleUser.moderator_assignments.map(a => (
                      <div key={a.id}
                        className="flex items-center justify-between bg-blue-50 rounded px-3 py-1.5 text-sm">
                        <span>{a.location} - {a.ground_name} {a.sport_type && `(${a.sport_type})`}</span>
                        <button onClick={() => removeAssignment(roleUser.id, 'moderator', a.id)}
                          className="text-red-500 hover:text-red-700 p-1">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-purple-700 mb-2">Ground Manager Assignments</h4>
                {roleUser.ground_management_assignments.length === 0 ? (
                  <p className="text-xs text-gray-400">No ground manager assignments</p>
                ) : (
                  <div className="space-y-1">
                    {roleUser.ground_management_assignments.map(a => (
                      <div key={a.id}
                        className="flex items-center justify-between bg-purple-50 rounded px-3 py-1.5 text-sm">
                        <span>{a.location} - {a.ground_name}</span>
                        <button onClick={() => removeAssignment(roleUser.id, 'ground_management', a.id)}
                          className="text-red-500 hover:text-red-700 p-1">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t pt-3">
                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
                  <Plus size={14} /> Assign Ground Role
                </h4>
                <div className="space-y-2">
                  <select value={selectedGround} onChange={e => setSelectedGround(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm">
                    <option value="">Select Ground...</option>
                    {grounds.map(g => (
                      <option key={g.id} value={g.id}>{g.location} - {g.name}</option>
                    ))}
                  </select>
                  <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm">
                    <option value="moderator">Moderator</option>
                    <option value="ground_management">Ground Manager</option>
                  </select>
                  {selectedRole === 'moderator' && (
                    <select value={selectedSportType} onChange={e => setSelectedSportType(e.target.value)}
                      className="w-full border rounded px-3 py-1.5 text-sm">
                      <option value="">All Sports</option>
                      {ALL_SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {roleError && <p className="text-red-500 text-sm">{roleError}</p>}
                  <Button onClick={assignGroundRole}
                    disabled={roleLoading || !selectedGround}
                    className="w-full" size="sm">
                    {roleLoading ? 'Assigning...' : 'Assign Role'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disable User Confirmation Modal */}
      {disableUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="border-b p-4 flex justify-between items-center rounded-t-2xl">
              <h3 className="font-bold text-red-700">Disable User: {disableUser.first_name} {disableUser.last_name}</h3>
              <button onClick={() => setDisableUser(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600">
                This will prevent <strong>{disableUser.first_name}</strong> from logging in or joining any games.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
                <textarea
                  value={disableReason}
                  onChange={e => setDisableReason(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  rows={2}
                  placeholder="e.g. Violated community guidelines"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDisableUser(null)} className="flex-1" size="sm">
                  Cancel
                </Button>
                <Button
                  onClick={() => handleDisableUser(disableUser)}
                  disabled={disableLoading}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white" size="sm">
                  {disableLoading ? 'Disabling...' : 'Disable User'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
