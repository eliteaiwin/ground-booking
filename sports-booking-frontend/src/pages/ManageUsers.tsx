import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Shield, Users } from 'lucide-react';

interface UserItem {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  notification_preference: string;
  roles: string[];
  sports: string[];
  locations: string[];
}

interface Props {
  onBack: () => void;
}

export default function ManageUsers({ onBack }: Props) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    api.listUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  const toggleRole = async (userId: number, role: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    setActionLoading(userId);
    try {
      const hasRole = user.roles.includes(role);
      let newRoles: string[];
      if (hasRole) {
        newRoles = user.roles.filter(r => r !== role);
        if (newRoles.length === 0) newRoles = ['user'];
      } else {
        newRoles = [...user.roles, role];
      }

      await api.updateUserRoles(userId, newRoles);
      setUsers(users.map(u => u.id === userId ? { ...u, roles: newRoles } : u));
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700';
      case 'moderator': return 'bg-blue-100 text-blue-700';
      case 'user': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
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
            <Users size={20} /> Manage Users
          </h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : users.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">No users found</CardContent>
          </Card>
        ) : (
          users.map(user => (
            <Card key={user.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-800">{user.first_name} {user.last_name}</h4>
                    <p className="text-xs text-gray-500">{user.phone}</p>
                    {user.email && <p className="text-xs text-gray-500">{user.email}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      Notif: {user.notification_preference === 'sms' ? 'SMS' : 'WhatsApp'}
                    </p>
                    {user.sports && user.sports.length > 0 && (
                      <p className="text-xs text-gray-400">Sports: {user.sports.join(', ')}</p>
                    )}
                    {user.locations && user.locations.length > 0 && (
                      <p className="text-xs text-gray-400">Locations: {user.locations.join(', ')}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {user.roles.map(role => (
                      <Badge key={role} className={`${roleColor(role)} text-xs capitalize`}>{role}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant={user.roles.includes('admin') ? 'default' : 'outline'}
                    className={`text-xs ${user.roles.includes('admin') ? 'bg-red-600 hover:bg-red-700' : ''}`}
                    onClick={() => toggleRole(user.id, 'admin')}
                    disabled={actionLoading === user.id}
                  >
                    <Shield size={12} className="mr-1" />
                    Admin
                  </Button>
                  <Button
                    size="sm"
                    variant={user.roles.includes('moderator') ? 'default' : 'outline'}
                    className={`text-xs ${user.roles.includes('moderator') ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    onClick={() => toggleRole(user.id, 'moderator')}
                    disabled={actionLoading === user.id}
                  >
                    <Shield size={12} className="mr-1" />
                    Moderator
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
