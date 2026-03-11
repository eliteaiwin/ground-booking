import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bell, Plus, Trophy, CreditCard, Users, Settings, SlidersHorizontal, MapPin, Shield, Archive, Search, FileText } from 'lucide-react';

interface Game {
  id: number;
  title: string;
  sport_type: string;
  ground_name: string;
  game_date: string;
  game_time: string;
  max_players: number;
  cost_per_person: number;
  payment_timing: string;
  status: string;
  is_archived: boolean;
  duration_minutes: number;
  selected_players: { user_id: number; name: string }[];
  waiting_list: { user_id: number; name: string }[];
  player_of_the_day: { name: string; votes: number } | null;
  payment_summary: { total: number; paid: number; pending: number };
}

interface Notification {
  id: number;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  game_title: string;
  sport_type: string;
}

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return <span className="text-2xl">&#9917;</span>;
  if (type === 'cricket') return <span className="text-2xl">&#127951;</span>;
  if (type === 'badminton') return <span className="text-2xl">&#127992;</span>;
  if (type === 'basketball') return <span className="text-2xl">&#127936;</span>;
  if (type === 'hockey') return <span className="text-2xl">&#127954;</span>;
  return <span className="text-2xl">&#127941;</span>;
};

const statusColor = (status: string, isArchived?: boolean) => {
  if (isArchived) return 'bg-gray-200 text-gray-600';
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700';
    case 'voting_open': return 'bg-green-100 text-green-700';
    case 'in_progress': return 'bg-blue-100 text-blue-700';
    case 'completed': return 'bg-purple-100 text-purple-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

const statusLabel = (status: string, isArchived?: boolean) => {
  if (isArchived) return 'Archived';
  switch (status) {
    case 'draft': return 'Draft';
    case 'voting_open': return 'Voting Open';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
};

interface Props {
  onNavigate: (page: string, gameId?: number) => void;
}

export default function Dashboard({ onNavigate }: Props) {
  const { user, logout, isAdmin, isModerator } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState('games');

  const currency = user?.currency || 'Rs';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [gamesData, notifsData] = await Promise.all([
        api.listGames(),
        api.getNotifications(),
      ]);
      setGames(gamesData);
      setNotifications(notifsData);
      setUnreadCount(notifsData.filter((n: Notification) => !n.is_read).length);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  const handleMarkAllRead = async () => {
    await api.markAllRead();
    setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const activeGames = games.filter(g => !g.is_archived);
  const archivedGames = games.filter(g => g.is_archived);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">&#9917;</span>
            <h1 className="text-lg font-bold">Ground Booking</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('notifications')}
              className="relative p-2 rounded-full hover:bg-green-700"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => onNavigate('profile')} className="p-2 rounded-full hover:bg-green-700">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Hey, {user?.first_name || user?.name}!</h2>
            <div className="flex gap-1 mt-1">
              {user?.roles.map(role => (
                <Badge key={role} variant="secondary" className="text-xs capitalize">{role}</Badge>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="text-gray-500">
            Logout
          </Button>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {isAdmin && (
            <button
              onClick={() => onNavigate('create-game')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <Plus size={20} className="text-green-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">New Game</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('my-payments')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <CreditCard size={20} className="text-blue-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Payments</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => onNavigate('admin-summary')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Trophy size={20} className="text-purple-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Summary</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onNavigate('manage-users')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <Users size={20} className="text-orange-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Users</span>
            </button>
          )}
          {(isAdmin || isModerator) && (
            <button
              onClick={() => onNavigate('moderator-preferences')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                <SlidersHorizontal size={20} className="text-teal-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Preferences</span>
            </button>
          )}
          {(isAdmin || isModerator) && (
            <button
              onClick={() => onNavigate('moderator-screens')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                <MapPin size={20} className="text-teal-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Locations</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onNavigate('admin-screens')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Shield size={20} className="text-purple-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Admin</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('search-grounds')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Search size={20} className="text-green-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Grounds</span>
          </button>
          {(isAdmin || isModerator) && (
            <button
              onClick={() => onNavigate('backend-settlement')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <FileText size={20} className="text-purple-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Settlement</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="games" className="flex-1">Games</TabsTrigger>
            <TabsTrigger value="archived" className="flex-1">
              Archived {archivedGames.length > 0 && `(${archivedGames.length})`}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1">
              Notifs {unreadCount > 0 && `(${unreadCount})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="games" className="mt-4 space-y-3">
            {activeGames.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  No active games. {isAdmin && 'Create one to get started!'}
                </CardContent>
              </Card>
            )}
            {activeGames.map(game => (
              <Card
                key={game.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onNavigate('game-detail', game.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">{sportIcon(game.sport_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-800 truncate">{game.title}</h3>
                        <Badge className={`${statusColor(game.status)} text-xs shrink-0`}>
                          {statusLabel(game.status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{game.ground_name}</p>
                      <p className="text-sm text-gray-500">
                        {game.game_date} at {game.game_time}
                        {game.duration_minutes > 0 && ` (${game.duration_minutes} mins)`}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>
                          <Users size={12} className="inline mr-1" />
                          {game.selected_players.length}/{game.max_players} players
                        </span>
                        {game.waiting_list.length > 0 && (
                          <span className="text-orange-500">
                            +{game.waiting_list.length} waiting
                          </span>
                        )}
                        <span>{game.cost_per_person} {currency}/person</span>
                      </div>
                      {game.player_of_the_day && (
                        <div className="mt-2 text-xs text-yellow-600 font-medium flex items-center gap-1">
                          <Trophy size={12} />
                          Man of the Match: {game.player_of_the_day.name}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="archived" className="mt-4 space-y-3">
            {archivedGames.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  <Archive size={24} className="mx-auto mb-2 text-gray-400" />
                  No archived games yet. Games are archived 1 week after completion.
                </CardContent>
              </Card>
            )}
            {archivedGames.map(game => (
              <Card
                key={game.id}
                className="cursor-pointer hover:shadow-md transition-shadow opacity-80"
                onClick={() => onNavigate('game-detail', game.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">{sportIcon(game.sport_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-800 truncate">{game.title}</h3>
                        <Badge className={`${statusColor(game.status, true)} text-xs shrink-0`}>
                          <Archive size={10} className="mr-1" /> Archived
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{game.ground_name}</p>
                      <p className="text-sm text-gray-500">{game.game_date}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>{game.selected_players.length} players</span>
                        {game.player_of_the_day && (
                          <span className="text-yellow-600 flex items-center gap-1">
                            <Trophy size={10} /> {game.player_of_the_day.name}
                          </span>
                        )}
                        {game.payment_summary.pending > 0 && (
                          <span className="text-red-500">{game.payment_summary.pending} unpaid</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="notifications" className="mt-4 space-y-2">
            {notifications.length > 0 && (
              <div className="flex justify-end mb-2">
                <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs">
                  Mark all as read
                </Button>
              </div>
            )}
            {notifications.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  No notifications yet
                </CardContent>
              </Card>
            )}
            {notifications.map(notif => (
              <Card
                key={notif.id}
                className={`${!notif.is_read ? 'border-l-4 border-l-green-500 bg-green-50/50' : ''}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    {notif.sport_type && sportIcon(notif.sport_type)}
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{notif.message}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(notif.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
