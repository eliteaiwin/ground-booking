import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, MapPin, Users, Phone, Clock, UserCheck, UserX, Bell, Plus, Search, X, Check, Shield, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Ground {
  id: number;
  name: string;
  location: string;
  display_name: string;
  assigned_at: string;
}

interface ScheduleItem {
  game_id: number;
  title: string;
  sport_type: string;
  status: string;
  game_date: string;
  game_time: string;
  duration_minutes: number;
  max_players: number;
  current_players: number;
  cost_per_person: number;
  created_by: string;
  creator_phone: string;
  moderators: { name: string; phone: string }[];
}

interface ScheduleData {
  ground_id: number;
  ground_name: string;
  location: string;
  start_date: string;
  end_date: string;
  schedule: ScheduleItem[];
}

type ViewMode = 'day' | 'week' | 'month';

const statusColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-200', border: 'border-gray-400', text: 'text-gray-700', label: 'Open for Booking' },
  voting_open: { bg: 'bg-yellow-200', border: 'border-yellow-500', text: 'text-yellow-800', label: 'Voting Open' },
  in_progress: { bg: 'bg-blue-200', border: 'border-blue-500', text: 'text-blue-800', label: 'Booked' },
  completed: { bg: 'bg-green-200', border: 'border-green-500', text: 'text-green-800', label: 'Completed' },
  cancelled: { bg: 'bg-red-200', border: 'border-red-400', text: 'text-red-700', label: 'Cancelled' },
};

const sportIcon = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  return '\uD83C\uDFC5';
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  let current = start;
  while (current <= end) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

function getHoursForDay(): string[] {
  const hours: string[] = [];
  for (let h = 6; h <= 23; h++) {
    hours.push(`${h.toString().padStart(2, '0')}:00`);
  }
  return hours;
}

interface Props {
  onBack: () => void;
}

interface LocationItem {
  id: number;
  name: string;
}

interface UserOption {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}

export default function GroundManagement({ onBack }: Props) {
  const { isAdmin, isGroundManagement, isModerator } = useAuth();
  const canAddGround = isAdmin || isGroundManagement;
  const canManageRequests = isAdmin || isGroundManagement;
  const isModeratorOnly = isModerator && !isAdmin && !isGroundManagement;
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [selectedGround, setSelectedGround] = useState<Ground | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoveredGame, setHoveredGame] = useState<ScheduleItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [, setAllGrounds] = useState<{ id: number; name: string; location: string; display_name: string }[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'schedule' | 'requests' | 'moderators'>('schedule');
  const [joinRequests, setJoinRequests] = useState<{ id: number; user_id: number; user_name: string; user_phone: string; sport_interests: string; message: string; status: string; created_at: string }[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [approveData, setApproveData] = useState<Record<number, { role: string; maxNominations: number }>>({});

  // Add Ground state
  const [showAddGround, setShowAddGround] = useState(false);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [newGroundName, setNewGroundName] = useState('');
  const [newGroundLocation, setNewGroundLocation] = useState('');
  const [modSearch, setModSearch] = useState('');
  const [modSearchResults, setModSearchResults] = useState<UserOption[]>([]);
  const [selectedModerators, setSelectedModerators] = useState<UserOption[]>([]);
  const [modSearchLoading, setModSearchLoading] = useState(false);
  const [addGroundLoading, setAddGroundLoading] = useState(false);
  const [addGroundError, setAddGroundError] = useState('');

  // Moderator management state
  interface GroundModerator {
    id: number;
    user_id: number;
    user_name: string;
    user_phone: string;
    user_email: string;
    sport_type: string;
  }
  const [groundModerators, setGroundModerators] = useState<GroundModerator[]>([]);
  const [moderatorsLoading, setModeratorsLoading] = useState(false);
  const [modMgmtSearch, setModMgmtSearch] = useState('');
  const [modMgmtSearchResults, setModMgmtSearchResults] = useState<UserOption[]>([]);
  const [modMgmtSearchLoading, setModMgmtSearchLoading] = useState(false);
  const [addModLoading, setAddModLoading] = useState(false);

  useEffect(() => {
    loadGrounds();
  }, []);

  const loadGrounds = async () => {
    setLoading(true);
    try {
      if (isAdmin || isGroundManagement) {
        // Admin and Ground Management see all grounds
        const groundsList = await api.listGrounds();
        const mapped = groundsList.map((g: { id: number; name: string; location: string; display_name: string }) => ({
          id: g.id,
          name: g.name,
          location: g.location,
          display_name: g.display_name,
          assigned_at: '',
        }));
        setGrounds(mapped);
        setAllGrounds(groundsList);
      } else {
        const managed = await api.myManagedGrounds();
        setGrounds(managed);
      }
    } catch (err) {
      console.error('Failed to load grounds:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAddGround = async () => {
    setShowAddGround(true);
    setNewGroundName('');
    setNewGroundLocation('');
    setModSearch('');
    setModSearchResults([]);
    setSelectedModerators([]);
    setAddGroundError('');
    try {
      const locs = await api.listLocations();
      setLocations(locs);
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  };

  const searchModerators = async (searchTerm: string) => {
    setModSearch(searchTerm);
    if (!newGroundLocation || searchTerm.length < 1) {
      setModSearchResults([]);
      return;
    }
    setModSearchLoading(true);
    try {
      const users = await api.usersByLocation(newGroundLocation, searchTerm);
      // Filter out already selected
      const selectedIds = new Set(selectedModerators.map(m => m.id));
      setModSearchResults(users.filter((u: UserOption) => !selectedIds.has(u.id)));
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setModSearchLoading(false);
    }
  };

  const addModerator = (user: UserOption) => {
    setSelectedModerators(prev => [...prev, user]);
    setModSearchResults(prev => prev.filter(u => u.id !== user.id));
    setModSearch('');
  };

  const removeModerator = (userId: number) => {
    setSelectedModerators(prev => prev.filter(m => m.id !== userId));
  };

  const handleAddGround = async () => {
    if (!newGroundName.trim()) { setAddGroundError('Ground name is required'); return; }
    if (!newGroundLocation) { setAddGroundError('Location is required'); return; }
    if (selectedModerators.length === 0) { setAddGroundError('At least one moderator is required'); return; }
    setAddGroundLoading(true);
    setAddGroundError('');
    try {
      await api.addGround(newGroundName.trim(), newGroundLocation, selectedModerators.map(m => m.id));
      setShowAddGround(false);
      await loadGrounds();
    } catch (err) {
      setAddGroundError(err instanceof Error ? err.message : 'Failed to add ground');
    } finally {
      setAddGroundLoading(false);
    }
  };

  const loadSchedule = async (groundId: number) => {
    try {
      let startDate: string;
      let endDate: string;

      if (viewMode === 'day') {
        startDate = currentDate;
        endDate = currentDate;
      } else if (viewMode === 'week') {
        const d = new Date(currentDate + 'T00:00:00');
        const dayOfWeek = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
        startDate = monday.toISOString().split('T')[0];
        endDate = addDays(startDate, 6);
      } else {
        // month
        const d = new Date(currentDate + 'T00:00:00');
        startDate = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        endDate = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${lastDay}`;
      }

      const data = await api.getGroundSchedule(groundId, startDate, endDate);
      setScheduleData(data);
    } catch (err) {
      console.error('Failed to load schedule:', err);
    }
  };

  useEffect(() => {
    if (selectedGround) {
      loadSchedule(selectedGround.id);
      loadJoinRequests(selectedGround.id);
      loadGroundModerators(selectedGround.id);
    }
  }, [selectedGround, viewMode, currentDate]);

  const loadGroundModerators = async (groundId: number) => {
    setModeratorsLoading(true);
    try {
      const data = await api.listGroundModerators(groundId);
      setGroundModerators(data);
    } catch (err) {
      console.error('Failed to load moderators:', err);
    } finally {
      setModeratorsLoading(false);
    }
  };

  const searchModsForGround = async (searchTerm: string) => {
    setModMgmtSearch(searchTerm);
    if (!selectedGround || searchTerm.length < 1) {
      setModMgmtSearchResults([]);
      return;
    }
    setModMgmtSearchLoading(true);
    try {
      const users = await api.usersByLocation(selectedGround.location, searchTerm);
      const existingIds = new Set(groundModerators.map(m => m.user_id));
      setModMgmtSearchResults(users.filter((u: UserOption) => !existingIds.has(u.id)));
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setModMgmtSearchLoading(false);
    }
  };

  const handleAddModToGround = async (user: UserOption) => {
    if (!selectedGround) return;
    setAddModLoading(true);
    try {
      await api.addGroundModerator(selectedGround.id, user.id);
      setModMgmtSearch('');
      setModMgmtSearchResults([]);
      await loadGroundModerators(selectedGround.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add moderator');
    } finally {
      setAddModLoading(false);
    }
  };

  const handleRemoveModFromGround = async (assignmentId: number) => {
    if (!selectedGround) return;
    if (!confirm('Remove this moderator from the ground?')) return;
    try {
      await api.removeGroundModerator(selectedGround.id, assignmentId);
      await loadGroundModerators(selectedGround.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove moderator');
    }
  };

  const loadJoinRequests = async (groundId: number) => {
    setRequestsLoading(true);
    try {
      const data = await api.listJoinRequests(groundId, 'pending');
      setJoinRequests(data);
    } catch (err) {
      console.error('Failed to load join requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleApproveRequest = async (groundId: number, requestId: number) => {
    const data = approveData[requestId] || { role: 'user', maxNominations: 0 };
    try {
      await api.approveJoinRequest(groundId, requestId, data.role, data.maxNominations);
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handleRejectRequest = async (groundId: number, requestId: number) => {
    try {
      await api.rejectJoinRequest(groundId, requestId);
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject');
    }
  };

  const navigateDate = (direction: number) => {
    if (viewMode === 'day') {
      setCurrentDate(addDays(currentDate, direction));
    } else if (viewMode === 'week') {
      setCurrentDate(addDays(currentDate, direction * 7));
    } else {
      const d = new Date(currentDate + 'T00:00:00');
      d.setMonth(d.getMonth() + direction);
      setCurrentDate(d.toISOString().split('T')[0]);
    }
  };

  const getDateRangeLabel = (): string => {
    if (!scheduleData) return '';
    if (viewMode === 'day') {
      return formatDate(currentDate);
    } else if (viewMode === 'week') {
      return `${formatDate(scheduleData.start_date)} - ${formatDate(scheduleData.end_date)}`;
    } else {
      const d = new Date(currentDate + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }
  };

  const handleMouseEnter = (game: ScheduleItem, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredGame(game);
    setTooltipPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const handleMouseLeave = () => {
    setHoveredGame(null);
  };

  // Render the Gantt chart
  const renderDayView = () => {
    if (!scheduleData) return null;
    const hours = getHoursForDay();
    const todayGames = scheduleData.schedule.filter(g => g.game_date === currentDate);

    return (
      <div className="overflow-x-auto" ref={chartRef}>
        <div className="min-w-[600px]">
          {/* Hours header */}
          <div className="flex border-b bg-gray-50">
            <div className="w-16 shrink-0 p-2 text-xs font-medium text-gray-500 border-r">Time</div>
            {hours.map(h => (
              <div key={h} className="flex-1 min-w-[60px] p-2 text-xs font-medium text-gray-500 text-center border-r">
                {h}
              </div>
            ))}
          </div>
          {/* Games row */}
          <div className="relative" style={{ height: Math.max(80, todayGames.length * 44 + 20) }}>
            <div className="flex absolute inset-0">
              <div className="w-16 shrink-0 border-r" />
              {hours.map(h => (
                <div key={h} className="flex-1 min-w-[60px] border-r border-dashed border-gray-100" />
              ))}
            </div>
            {todayGames.map((game, idx) => {
              const [gH, gM] = (game.game_time || '00:00').split(':').map(Number);
              const startMinutes = (gH - 6) * 60 + (gM || 0);
              const totalMinutes = (23 - 6 + 1) * 60;
              const leftPercent = Math.max(0, (startMinutes / totalMinutes) * 100);
              const widthPercent = Math.max(3, (game.duration_minutes / totalMinutes) * 100);
              const colors = statusColors[game.status] || statusColors.draft;

              return (
                <div
                  key={game.game_id}
                  className={`absolute ${colors.bg} ${colors.border} border rounded-md px-2 py-1 text-xs cursor-pointer hover:shadow-md transition-shadow z-10`}
                  style={{
                    left: `calc(64px + ${leftPercent}% * (100% - 64px) / 100)`,
                    width: `calc(${widthPercent}% * (100% - 64px) / 100)`,
                    top: 8 + idx * 44,
                    height: 36,
                    marginLeft: `${leftPercent * 0.01 * (100 - 10)}%`,
                  }}
                  onMouseEnter={(e) => handleMouseEnter(game, e)}
                  onMouseLeave={handleMouseLeave}
                >
                  <div className={`font-medium ${colors.text} truncate`}>
                    {sportIcon(game.sport_type)} {game.title}
                  </div>
                  <div className="text-gray-500 truncate">
                    {game.game_time} ({game.duration_minutes}m)
                  </div>
                </div>
              );
            })}
            {todayGames.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                No games scheduled
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    if (!scheduleData) return null;
    const days = getDaysInRange(scheduleData.start_date, scheduleData.end_date);
    const today = new Date().toISOString().split('T')[0];

    return (
      <div className="overflow-x-auto" ref={chartRef}>
        <div className="min-w-[600px]">
          {days.map(day => {
            const dayGames = scheduleData.schedule.filter(g => g.game_date === day);
            const isToday = day === today;

            return (
              <div key={day} className={`border-b ${isToday ? 'bg-blue-50/50' : ''}`}>
                <div className={`flex items-center gap-2 px-3 py-2 ${isToday ? 'bg-blue-100/50' : 'bg-gray-50'}`}>
                  <span className={`text-sm font-medium ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                    {formatDate(day)}
                  </span>
                  {isToday && <Badge className="bg-blue-500 text-xs">Today</Badge>}
                  <span className="text-xs text-gray-400 ml-auto">{dayGames.length} game{dayGames.length !== 1 ? 's' : ''}</span>
                </div>
                {dayGames.length > 0 ? (
                  <div className="px-3 py-2 space-y-1.5">
                    {dayGames.map(game => {
                      const colors = statusColors[game.status] || statusColors.draft;
                      return (
                        <div
                          key={game.game_id}
                          className={`${colors.bg} ${colors.border} border rounded-lg px-3 py-2 cursor-pointer hover:shadow-md transition-shadow`}
                          onMouseEnter={(e) => handleMouseEnter(game, e)}
                          onMouseLeave={handleMouseLeave}
                        >
                          <div className="flex items-center gap-2">
                            <span>{sportIcon(game.sport_type)}</span>
                            <span className={`font-medium text-sm ${colors.text}`}>{game.title}</span>
                            <Badge className={`${colors.bg} ${colors.text} text-xs ml-auto border-0`}>{colors.label}</Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-600">
                            <span className="flex items-center gap-1"><Clock size={10} /> {game.game_time} ({game.duration_minutes}m)</span>
                            <span className="flex items-center gap-1"><Users size={10} /> {game.current_players}/{game.max_players}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-3 text-xs text-gray-400 italic">No bookings</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    if (!scheduleData) return null;
    const d = new Date(currentDate + 'T00:00:00');
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday start
    const totalDays = lastDay.getDate();
    const today = new Date().toISOString().split('T')[0];

    const weeks: string[][] = [];
    let week: string[] = [];
    for (let i = 0; i < startOffset; i++) {
      week.push('');
    }
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      week.push(dateStr);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push('');
      weeks.push(week);
    }

    const gamesByDate: Record<string, ScheduleItem[]> = {};
    for (const game of scheduleData.schedule) {
      if (!gamesByDate[game.game_date]) gamesByDate[game.game_date] = [];
      gamesByDate[game.game_date].push(game);
    }

    return (
      <div className="overflow-x-auto" ref={chartRef}>
        <div className="min-w-[600px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-gray-50">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="p-2 text-xs font-medium text-gray-500 text-center border-r">{d}</div>
            ))}
          </div>
          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b">
              {week.map((dateStr, di) => {
                if (!dateStr) return <div key={di} className="min-h-[80px] bg-gray-50 border-r" />;
                const dayNum = parseInt(dateStr.split('-')[2]);
                const isToday = dateStr === today;
                const dayGames = gamesByDate[dateStr] || [];

                return (
                  <div key={di} className={`min-h-[80px] border-r p-1 ${isToday ? 'bg-blue-50' : ''}`}>
                    <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-700 bg-blue-200 w-5 h-5 rounded-full flex items-center justify-center' : 'text-gray-600'}`}>
                      {dayNum}
                    </div>
                    {dayGames.slice(0, 3).map(game => {
                      const colors = statusColors[game.status] || statusColors.draft;
                      return (
                        <div
                          key={game.game_id}
                          className={`${colors.bg} ${colors.text} text-xs rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer hover:opacity-80`}
                          onMouseEnter={(e) => handleMouseEnter(game, e)}
                          onMouseLeave={handleMouseLeave}
                        >
                          {game.game_time.slice(0, 5)} {sportIcon(game.sport_type)}
                        </div>
                      );
                    })}
                    {dayGames.length > 3 && (
                      <div className="text-xs text-gray-400">+{dayGames.length - 3} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading grounds...</p>
      </div>
    );
  }

  // Ground selection screen
  if (!selectedGround) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-amber-600 text-white shadow-lg">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={onBack} className="p-1 rounded-full hover:bg-amber-700">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
              <h1 className="text-lg font-bold">Ground Management</h1>
              <p className="text-amber-100 text-xs">Select a ground to view schedule</p>
            </div>
            {canAddGround && (
              <button onClick={openAddGround} className="p-2 rounded-full hover:bg-amber-700" title="Add Ground">
                <Plus size={20} />
              </button>
            )}
          </div>
        </header>

        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {grounds.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <MapPin size={24} className="mx-auto mb-2 text-gray-400" />
                No grounds assigned to you. Contact an admin for access.
              </CardContent>
            </Card>
          ) : (
            grounds.map(ground => (
              <Card
                key={ground.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedGround(ground)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                      <MapPin size={20} className="text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">{ground.display_name}</h3>
                      <p className="text-sm text-gray-500">{ground.location}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Add Ground Modal */}
        {showAddGround && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b bg-amber-50 rounded-t-2xl flex items-center justify-between">
                <h3 className="text-lg font-bold text-amber-800">Add New Ground</h3>
                <button onClick={() => setShowAddGround(false)} className="p-1 rounded-full hover:bg-amber-100">
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <Label className="text-sm font-medium">Location *</Label>
                  <Select value={newGroundLocation} onValueChange={(val) => { setNewGroundLocation(val); setSelectedModerators([]); setModSearchResults([]); setModSearch(''); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium">Ground Name *</Label>
                  <Input
                    value={newGroundName}
                    onChange={e => setNewGroundName(e.target.value)}
                    placeholder="e.g. Whitefield Sports Arena"
                    className="mt-1"
                  />
                </div>

                {/* Moderator Selection */}
                <div>
                  <Label className="text-sm font-medium">Moderator(s) * <span className="text-gray-400 font-normal">(at least 1 required)</span></Label>

                  {/* Selected moderators */}
                  {selectedModerators.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {selectedModerators.map(mod => (
                        <div key={mod.id} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          <Check size={14} className="text-green-600" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800">{mod.name}</span>
                            <span className="text-xs text-gray-500 ml-2">{mod.phone}</span>
                          </div>
                          <button onClick={() => removeModerator(mod.id)} className="p-0.5 rounded-full hover:bg-red-100">
                            <X size={14} className="text-red-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Search for users in selected location */}
                  {newGroundLocation ? (
                    <div className="mt-2 relative">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <Input
                          value={modSearch}
                          onChange={e => searchModerators(e.target.value)}
                          placeholder="Search users by name, phone or email..."
                          className="pl-8 text-sm"
                        />
                      </div>
                      {modSearchLoading && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
                      {modSearchResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {modSearchResults.map(user => (
                            <button
                              key={user.id}
                              onClick={() => addModerator(user)}
                              className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center gap-2 border-b last:border-b-0"
                            >
                              <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-600">
                                {(user.first_name || user.name || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{user.name}</p>
                                <p className="text-xs text-gray-500">{user.phone}{user.email ? ` • ${user.email}` : ''}</p>
                              </div>
                              <Plus size={14} className="text-green-500" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-2">Select a location first to browse users</p>
                  )}
                </div>

                {addGroundError && <p className="text-red-500 text-sm">{addGroundError}</p>}

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleAddGround} disabled={addGroundLoading} className="flex-1 bg-amber-600 hover:bg-amber-700">
                    {addGroundLoading ? 'Adding...' : 'Add Ground'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddGround(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Schedule view
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-amber-600 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedGround(null)} className="p-1 rounded-full hover:bg-amber-700">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold truncate">{selectedGround.display_name}</h1>
              <p className="text-amber-100 text-xs">{selectedGround.location}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* Read-only indicator for moderators */}
        {isModeratorOnly && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-2">
            <Calendar size={14} className="text-blue-500" />
            <span className="text-sm text-blue-700">Moderator view — You can view the schedule and manage moderators for your grounds</span>
          </div>
        )}

        {/* Tab selector */}
        <div className="flex bg-white rounded-lg shadow-sm border overflow-hidden mb-4">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'schedule' ? 'bg-amber-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Calendar size={14} className="inline mr-1" /> Schedule
          </button>
          {canManageRequests && (
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex-1 px-4 py-2 text-sm font-medium relative ${activeTab === 'requests' ? 'bg-amber-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Bell size={14} className="inline mr-1" /> Join Requests
              {joinRequests.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-red-500 text-white">{joinRequests.length}</span>
              )}
            </button>
          )}
          <button
            onClick={() => setActiveTab('moderators')}
            className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'moderators' ? 'bg-amber-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Shield size={14} className="inline mr-1" /> Moderators
          </button>
        </div>

        {activeTab === 'requests' && (
          <div className="space-y-3">
            {requestsLoading ? (
              <p className="text-gray-500 text-center py-8">Loading requests...</p>
            ) : joinRequests.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  <UserCheck size={24} className="mx-auto mb-2 text-gray-400" />
                  No pending join requests
                </CardContent>
              </Card>
            ) : (
              joinRequests.map(req => {
                const ad = approveData[req.id] || { role: 'user', maxNominations: 0 };
                return (
                  <Card key={req.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                          {(req.user_name || '?')[0]}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800">{req.user_name}</p>
                          <p className="text-xs text-gray-500">{req.user_phone}</p>
                          {req.sport_interests && <p className="text-xs text-green-600 mt-1">Sports: {req.sport_interests}</p>}
                          {req.message && <p className="text-xs text-gray-400 mt-1 italic">"{req.message}"</p>}
                          <p className="text-xs text-gray-400 mt-1">{req.created_at}</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">User Role</Label>
                            <Select
                              value={ad.role}
                              onValueChange={(val) => setApproveData(prev => ({ ...prev, [req.id]: { ...ad, role: val } }))}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">Normal User</SelectItem>
                                <SelectItem value="readonly">Read-Only User</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Max Nominations</Label>
                            <Input
                              type="number"
                              min={0}
                              className="h-8 text-xs"
                              placeholder="0 = unlimited"
                              value={ad.maxNominations || ''}
                              onChange={e => setApproveData(prev => ({ ...prev, [req.id]: { ...ad, maxNominations: parseInt(e.target.value) || 0 } }))}
                            />
                            <p className="text-xs text-gray-400 mt-0.5">0 = unlimited, includes self</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-xs flex-1" onClick={() => selectedGround && handleApproveRequest(selectedGround.id, req.id)}>
                            <UserCheck size={14} className="mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="text-xs flex-1" onClick={() => selectedGround && handleRejectRequest(selectedGround.id, req.id)}>
                            <UserX size={14} className="mr-1" /> Reject
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'moderators' && (
          <div className="space-y-4">
            {/* Add moderator search */}
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Plus size={14} /> Add Moderator
                </h3>
                {selectedGround ? (
                  <div className="relative">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={modMgmtSearch}
                        onChange={e => searchModsForGround(e.target.value)}
                        placeholder="Search users by name, phone or email..."
                        className="pl-8 text-sm"
                        disabled={addModLoading}
                      />
                    </div>
                    {modMgmtSearchLoading && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
                    {modMgmtSearchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {modMgmtSearchResults.map(user => (
                          <button
                            key={user.id}
                            onClick={() => handleAddModToGround(user)}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center gap-2 border-b last:border-b-0"
                            disabled={addModLoading}
                          >
                            <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-600">
                              {(user.first_name || user.name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{user.name}</p>
                              <p className="text-xs text-gray-500">{user.phone}{user.email ? ` • ${user.email}` : ''}</p>
                            </div>
                            <Plus size={14} className="text-green-500" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Select a ground first</p>
                )}
              </CardContent>
            </Card>

            {/* Current moderators list */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Shield size={14} className="text-purple-600" /> Current Moderators ({groundModerators.length})
              </h3>
              {moderatorsLoading ? (
                <p className="text-gray-500 text-center py-4">Loading...</p>
              ) : groundModerators.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center text-gray-500">
                    <Shield size={24} className="mx-auto mb-2 text-gray-400" />
                    No moderators assigned
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {groundModerators.map(mod => (
                    <Card key={mod.id}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="w-9 h-9 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold text-sm">
                          {(mod.user_name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{mod.user_name}</p>
                          <p className="text-xs text-gray-500">
                            <Phone size={10} className="inline mr-1" />{mod.user_phone}
                            {mod.user_email && <span className="ml-2">{mod.user_email}</span>}
                          </p>
                          <Badge className="bg-purple-100 text-purple-700 text-xs mt-1">{mod.sport_type}</Badge>
                        </div>
                        <button
                          onClick={() => handleRemoveModFromGround(mod.id)}
                          className="p-1.5 rounded-full hover:bg-red-50 text-red-400 hover:text-red-600"
                          title="Remove moderator"
                        >
                          <Trash2 size={16} />
                        </button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'schedule' && <>
        {/* Controls */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          {/* View mode selector */}
          <div className="flex bg-white rounded-lg shadow-sm border overflow-hidden">
            {(['day', 'week', 'month'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 text-sm font-medium capitalize ${viewMode === mode ? 'bg-amber-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Date navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigateDate(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-medium text-gray-700 min-w-[180px] text-center">
              {getDateRangeLabel()}
            </span>
            <Button variant="outline" size="sm" onClick={() => navigateDate(1)}>
              <ChevronRight size={16} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentDate(new Date().toISOString().split('T')[0])}
              className="text-xs"
            >
              Today
            </Button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const modes: ViewMode[] = ['day', 'week', 'month'];
                const idx = modes.indexOf(viewMode);
                if (idx > 0) setViewMode(modes[idx - 1]);
              }}
              disabled={viewMode === 'day'}
            >
              <ZoomIn size={16} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const modes: ViewMode[] = ['day', 'week', 'month'];
                const idx = modes.indexOf(viewMode);
                if (idx < modes.length - 1) setViewMode(modes[idx + 1]);
              }}
              disabled={viewMode === 'month'}
            >
              <ZoomOut size={16} />
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(statusColors).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${val.bg} ${val.border} border`} />
              <span className="text-xs text-gray-600">{val.label}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {viewMode === 'day' && renderDayView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'month' && renderMonthView()}
          </CardContent>
        </Card>

        </>}

        {/* Tooltip */}
        {hoveredGame && (
          <div
            className="fixed z-50 bg-white rounded-xl shadow-xl border p-4 w-72"
            style={{ left: Math.min(tooltipPos.x, window.innerWidth - 300), top: tooltipPos.y }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{sportIcon(hoveredGame.sport_type)}</span>
              <div className="flex-1">
                <h4 className="font-semibold text-gray-800">{hoveredGame.title}</h4>
                <Badge className={`${statusColors[hoveredGame.status]?.bg || 'bg-gray-200'} ${statusColors[hoveredGame.status]?.text || 'text-gray-700'} text-xs border-0`}>
                  {statusColors[hoveredGame.status]?.label || hoveredGame.status}
                </Badge>
              </div>
            </div>
            <div className="space-y-1.5 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar size={12} />
                <span>{hoveredGame.game_date} at {hoveredGame.game_time}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={12} />
                <span>{hoveredGame.duration_minutes} minutes</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={12} />
                <span>{hoveredGame.current_players}/{hoveredGame.max_players} players</span>
              </div>
              {hoveredGame.created_by && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Booked by:</span>
                  <span>{hoveredGame.created_by}</span>
                </div>
              )}
              {hoveredGame.moderators.length > 0 && (
                <div className="border-t pt-1.5 mt-1.5">
                  <p className="text-xs font-medium text-gray-500 mb-1">Moderators:</p>
                  {hoveredGame.moderators.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Phone size={10} />
                      <span>{m.name} - {m.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
