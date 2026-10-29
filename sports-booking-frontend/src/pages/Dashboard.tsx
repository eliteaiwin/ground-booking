import { useState, useEffect } from 'react';
import { maskedPhoneText } from '@/lib/player';
import { formatPhone } from '@/lib/phone';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bell, Plus, Trophy, CreditCard, Users, SlidersHorizontal, MapPin, Shield, Archive, Search, FileText, Calendar, UserCircle, ChevronDown, UserPlus, ArrowRightLeft, Pencil, LogOut, Info, BarChart3, RefreshCw, CalendarDays, Share2, Wallet } from 'lucide-react';
import { WhatsNew } from '@/components/WhatsNew';
import { AboutDialog } from '@/components/AboutDialog';
import { InviteDialog } from '@/components/InviteDialog';
import { inviteUrl } from '@/lib/invite';
import { formatMoney, currencySymbol } from '@/lib/currency';

interface Game {
  id: number;
  title: string;
  sport_type: string;
  ground_name: string;
  game_date: string;
  game_time: string;
  max_players: number;
  cost_per_person: number;
  currency?: string;
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
  game_id?: number | null;
  game_status?: string;
  game_date?: string;
  game_time?: string;
}

const formatNamePhone = (name: string, phone?: string) => {
  const firstName = (name || '').split(' ')[0];
  const masked = maskedPhoneText(phone);
  return masked ? `${firstName} - ${masked}` : firstName;
};

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return <span className="text-2xl">&#9917;</span>;
  if (type === 'cricket') return <span className="text-2xl">&#127951;</span>;
  if (type === 'badminton') return <span className="text-2xl">&#127992;</span>;
  if (type === 'basketball') return <span className="text-2xl">&#127936;</span>;
  if (type === 'hockey') return <span className="text-2xl">&#127954;</span>;
  return <span className="text-2xl">&#127941;</span>;
};

const ARCHIVE_PERIODS = [
  { key: 'week', label: 'Last week', maxDays: 7 },
  { key: 'month', label: 'Last month', maxDays: 30 },
  { key: 'six_months', label: 'Last 6 months', maxDays: 182 },
  { key: 'year', label: 'Last year', maxDays: 365 },
  { key: 'older', label: 'Older', maxDays: Infinity },
] as const;
type ArchivePeriod = typeof ARCHIVE_PERIODS[number]['key'];

const archivePeriodOf = (gameDate: string): ArchivePeriod => {
  const days = (Date.now() - new Date(`${gameDate}T00:00:00`).getTime()) / 86400000;
  return (ARCHIVE_PERIODS.find(p => days <= p.maxDays) ?? ARCHIVE_PERIODS[ARCHIVE_PERIODS.length - 1]).key;
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
    case 'voting_open': return 'Open for Nomination';
    case 'in_progress': return 'Game Started';
    case 'completed': return 'Completed';
    default: return status;
  }
};

interface Props {
  onNavigate: (page: string, gameId?: number) => void;
}

const roleDisplayNames: Record<string, string> = {
  admin: 'Admin',
  ground_management: 'Ground Management',
  payment_receiver: 'Payment Receiver',
  moderator: 'Moderator',
  user: 'User',
  readonly: 'User (Read Only)',
};

interface ReceiverGame {
  id: number; title: string; series_name: string; game_date: string; status: string; nick_name: string; currency: string;
  players: number; owed: number; paid: number; confirmed: number; to_confirm: number; unpaid: number;
}

export default function Dashboard({ onNavigate }: Props) {
  const { user, logout, isAdmin, isModerator, isGroundManagement, isReceiver, isReadOnly, activeRole, switchRole, storedAccounts, switchAccount, setIsAddingAccount } = useAuth();
  const { activeTheme } = useTheme();
  const [games, setGames] = useState<Game[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState('games');
  const [archivePeriod, setArchivePeriod] = useState<ArchivePeriod>('week');
  const [showAbout, setShowAbout] = useState(false);
  const [showRefer, setShowRefer] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [receiverGames, setReceiverGames] = useState<ReceiverGame[]>([]);
  useEffect(() => {
    if (isReceiver) api.myReceiverGames().then(setReceiverGames).catch(() => setReceiverGames([]));
  }, [isReceiver]);
  const [showSwitchUser, setShowSwitchUser] = useState(false);
  const [showSwitchRole, setShowSwitchRole] = useState(false);

  const currency = currencySymbol(user?.currency);
  const otherAccounts = storedAccounts.filter(a => a.userId !== user?.id);

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

  const openFromNotification = (n: Notification) => {
    if (!n.game_id) return;
    const start = new Date(`${n.game_date}T${(n.game_time || '00:00').slice(0, 5)}`).getTime();
    const open = !!n.game_date && ['draft', 'voting_open'].includes(n.game_status || '') && start > Date.now();
    if (!open) {
      window.alert('Too late! This game has already started or is no longer open for nomination.');
      return;
    }
    onNavigate('game-detail', n.game_id);
  };

  const activeGames = games.filter(g => !g.is_archived);
  const archivedGames = games.filter(g => g.is_archived);
  const archiveCounts = archivedGames.reduce<Record<string, number>>((acc, g) => {
    const k = archivePeriodOf(g.game_date);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const archivedInPeriod = archivedGames.filter(g => archivePeriodOf(g.game_date) === archivePeriod);

  return (
    <div className="min-h-screen bg-gray-50">
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showRefer && <InviteDialog title="Refer a friend" url={inviteUrl(user?.id)}
        message="Join me on Elite Turf Booking to book and play games:" onClose={() => setShowRefer(false)} />}
      <header className="text-white shadow-lg" style={{ backgroundColor: activeTheme.header_bg }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="About" data-testid="about-logo" className="text-2xl" onClick={() => setShowAbout(true)}>&#9917;</button>
            <div className="flex flex-col items-end leading-tight">
              <h1 className="text-lg font-bold"><span className="text-red-600">Elite</span> Turf Booking</h1>
              <WhatsNew />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('notifications')}
              className="relative p-2 rounded-full hover:opacity-80"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <div className="relative">
              <button
                onClick={() => { setShowUserMenu(!showUserMenu); setShowSwitchUser(false); }}
                className="flex items-center gap-1 p-1.5 rounded-full hover:opacity-80"
              >
                <UserCircle size={22} />
                <ChevronDown size={14} />
              </button>

              {/* User Menu Dropdown */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setShowUserMenu(false); setShowSwitchUser(false); setShowSwitchRole(false); }} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border z-50 overflow-hidden">
                    {/* Current user header */}
                    <div className="px-4 py-3 bg-gray-50 border-b">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-bold" style={{ backgroundColor: activeTheme.primary_color }}>
                          {user?.first_name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate" data-testid="menu-user">
                            {`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.name || 'User'}
                          </p>
                          <p className="text-xs text-gray-600 truncate">
                            {(localStorage.getItem('login_via') === 'email' || !user?.phone) ? (user?.email || formatPhone(user?.phone)) : formatPhone(user?.phone)}
                          </p>
                        </div>
                      </div>
                      {activeRole && (
                        <p className="text-xs text-gray-700 mt-1" data-testid="menu-role">
                          Role: <span className="font-semibold">{roleDisplayNames[activeRole] || activeRole}</span>
                        </p>
                      )}
                    </div>

                    {/* Menu items */}
                    <div className="py-1">
                      <button
                        onClick={() => { setShowUserMenu(false); onNavigate('profile'); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Pencil size={16} className="text-gray-400" />
                        Edit Profile
                      </button>

                      {/* Switch Role option */}
                      {user && user.roles.length > 1 && (
                        <button
                          onClick={() => { setShowSwitchRole(!showSwitchRole); setShowSwitchUser(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <RefreshCw size={16} className="text-gray-400" />
                          Switch Role
                          <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${showSwitchRole ? 'rotate-180' : ''}`} />
                        </button>
                      )}

                      {/* Switch Role submenu */}
                      {showSwitchRole && user && user.roles.length > 1 && (
                        <div className="bg-gray-50 border-y">
                          {user.roles.map(role => (
                            <button
                              key={role}
                              onClick={() => {
                                switchRole(role);
                                setShowSwitchRole(false);
                                setShowUserMenu(false);
                              }}
                              className={`w-full flex items-center gap-3 px-6 py-2 text-sm transition-colors ${role === activeRole ? 'font-medium' : 'hover:bg-gray-100 text-gray-700'}`}
                              style={role === activeRole ? { backgroundColor: `${activeTheme.primary_color}15`, color: activeTheme.primary_color } : undefined}
                            >
                              <div className={`w-2 h-2 rounded-full ${role === activeRole ? '' : 'bg-gray-300'}`} style={role === activeRole ? { backgroundColor: activeTheme.primary_color } : undefined} />
                              {roleDisplayNames[role] || role}
                              {role === activeRole && <span className="ml-auto text-xs" style={{ color: activeTheme.primary_color }}>(Active)</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {otherAccounts.length > 0 && (
                        <button
                          onClick={() => { setShowSwitchUser(!showSwitchUser); setShowSwitchRole(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <ArrowRightLeft size={16} className="text-gray-400" />
                          Switch User
                          <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${showSwitchUser ? 'rotate-180' : ''}`} />
                        </button>
                      )}

                      {/* Switch User submenu */}
                      {showSwitchUser && otherAccounts.length > 0 && (
                        <div className="bg-gray-50 border-y">
                          {otherAccounts.map(account => (
                            <button
                              key={account.userId}
                              onClick={async () => {
                                setShowUserMenu(false);
                                setShowSwitchUser(false);
                                await switchAccount(account.userId);
                              }}
                              className="w-full flex items-center gap-3 px-6 py-2 text-sm hover:bg-gray-100 transition-colors"
                            >
                              <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                                {account.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0 text-left">
                                <p className="text-sm text-gray-800 truncate">{formatNamePhone(account.name, account.phone)}</p>
                              </div>
                              <div className="flex gap-0.5">
                                {account.roles.map(r => (
                                  <span key={r} className="text-xs bg-gray-200 px-1 rounded capitalize">{r}</span>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          setIsAddingAccount(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <UserPlus size={16} className="text-gray-400" />
                        Add User
                      </button>

                      <button
                        onClick={() => { setShowUserMenu(false); setShowRefer(true); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        data-testid="refer-friend"
                      >
                        <Share2 size={16} className="text-gray-400" />
                        Refer a friend
                      </button>

                      <button
                        onClick={() => { setShowUserMenu(false); setShowAbout(true); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Info size={16} className="text-gray-400" />
                        About
                      </button>

                      <div className="border-t my-1" />

                      <button
                        onClick={() => { setShowUserMenu(false); logout(); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <LogOut size={16} />
                        Logout
                      </button>
                    </div>

                    {/* Account count indicator */}
                    {storedAccounts.length > 1 && (
                      <div className="px-4 py-2 bg-blue-50 border-t text-xs text-blue-600 text-center">
                        {storedAccounts.length} accounts logged in
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Hey, {user?.first_name || user?.name}!</h2>
            <div className="flex gap-1 mt-1">
              <Badge variant="default" className="text-xs" style={{ backgroundColor: activeTheme.primary_color }}>{roleDisplayNames[activeRole] || activeRole}</Badge>
            </div>
          </div>
          {storedAccounts.length > 1 && (
            <span className="text-xs text-gray-400">{storedAccounts.length} accounts</span>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Admin/Moderator/Ground Management actions */}
          {(isAdmin || isModerator || isGroundManagement) && (
            <>
              <button
                onClick={() => onNavigate('create-game')}
                className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Plus size={20} className="text-green-600" />
                </div>
                <span className="text-xs font-medium text-gray-700">New Game</span>
              </button>
              <button
                onClick={() => onNavigate('create-series')}
                className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <CalendarDays size={20} className="text-green-600" />
                </div>
                <span className="text-xs font-medium text-gray-700">New Series</span>
              </button>
            </>
          )}
          {!isReadOnly && (
            <button
              onClick={() => onNavigate('my-payments')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <CreditCard size={20} className="text-blue-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Payments</span>
            </button>
          )}
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
          {/* Ground Management - visible to Ground Management, Moderator, and Admin */}
          {(isGroundManagement || isModerator) && (
            <button
              onClick={() => onNavigate('ground-management')}
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <BarChart3 size={20} className="text-amber-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Ground Mgmt</span>
            </button>
          )}
          {(isAdmin || isGroundManagement) && (
            <button
              onClick={() => onNavigate('payment-receivers')}
              data-testid="nav-payment-receivers"
              className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <Wallet size={20} className="text-green-600" />
              </div>
              <span className="text-xs font-medium text-gray-700">Receivers</span>
            </button>
          )}
          {/* Hall of Fame - visible to all */}
          <button
            onClick={() => onNavigate('hall-of-fame')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
              <Trophy size={20} className="text-yellow-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Hall of Fame</span>
          </button>
          {/* Notification Settings - visible to all */}
          <button
            onClick={() => onNavigate('notification-settings')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
              <Bell size={20} className="text-indigo-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Alert Settings</span>
          </button>
          <button
            onClick={() => onNavigate('search-grounds')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Search size={20} className="text-green-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Grounds</span>
          </button>
          <button
            onClick={() => onNavigate('game-search')}
            className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
              <Calendar size={20} className="text-indigo-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Find Games</span>
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

        {isReceiver && (
          <Card className="mb-4" data-testid="receiver-games">
            <CardContent className="p-3 space-y-2">
              <h2 className="font-semibold flex items-center gap-2"><Wallet size={16} /> Payments to my wallet</h2>
              {receiverGames.length === 0 && <p className="text-sm text-gray-500">No games pay to your wallet yet.</p>}
              {receiverGames.map(g => (
                <button key={g.id} type="button" onClick={() => onNavigate('game-detail', g.id)} data-testid="receiver-game"
                  className="w-full text-left p-2 border rounded-lg hover:bg-gray-50">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm truncate">{g.series_name || g.title}</span>
                    <span className="text-xs text-gray-500 shrink-0">{g.game_date}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {g.nick_name} · Paid {formatMoney(Math.round(g.paid), g.currency)} of {formatMoney(Math.round(g.owed), g.currency)} · Confirmed {formatMoney(Math.round(g.confirmed), g.currency)}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {g.to_confirm > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">{g.to_confirm} to confirm</Badge>}
                    {g.status === 'completed' && g.unpaid > 0 && <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px]">{g.unpaid} unpaid</Badge>}
                    {g.status === 'completed' && g.players > 0 && g.to_confirm === 0 && g.unpaid === 0 && <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-[10px]">Fully settled</Badge>}
                    {g.status !== 'completed' && <Badge variant="outline" className="text-[10px]">Upcoming</Badge>}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

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
                        <h3 className="font-semibold text-gray-800 truncate">{game.ground_name}</h3>
                        <Badge className={`${statusColor(game.status)} text-xs shrink-0`}>
                          {statusLabel(game.status)}
                        </Badge>
                      </div>
                      {game.title && <p className="text-sm text-gray-600 font-medium truncate">{game.title}</p>}
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
                        <span>{formatMoney(game.cost_per_person, game.currency || currency)}/person</span>
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
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {ARCHIVE_PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setArchivePeriod(p.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${archivePeriod === p.key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                >
                  {p.label}{archiveCounts[p.key] ? ` (${archiveCounts[p.key]})` : ''}
                </button>
              ))}
            </div>
            {archivedInPeriod.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  <Archive size={24} className="mx-auto mb-2 text-gray-400" />
                  No archived games in this period. Games move here automatically once they're over.
                </CardContent>
              </Card>
            )}
            {archivedInPeriod.map(game => (
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
                        <h3 className="font-semibold text-gray-800 truncate">{game.ground_name}</h3>
                        <Badge className={`${statusColor(game.status, true)} text-xs shrink-0`}>
                          <Archive size={10} className="mr-1" /> Archived
                        </Badge>
                      </div>
                      {game.title && <p className="text-sm text-gray-600 font-medium truncate">{game.title}</p>}
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
                      {notif.game_id && /Join now!?$/.test(notif.message) ? (
                        <p className="text-sm text-gray-800">
                          {notif.message.replace(/Join now!?$/, '')}
                          <button
                            type="button"
                            className="font-semibold text-green-700 underline hover:text-green-800"
                            onClick={() => openFromNotification(notif)}
                            data-testid="notif-join"
                          >
                            Join now!
                          </button>
                        </p>
                      ) : (
                        <p className="text-sm text-gray-800">{notif.message}</p>
                      )}
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
