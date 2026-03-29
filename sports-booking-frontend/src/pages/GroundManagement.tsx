import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, MapPin, Users, Phone, Clock } from 'lucide-react';

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

export default function GroundManagement({ onBack }: Props) {
  const { isAdmin } = useAuth();
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [selectedGround, setSelectedGround] = useState<Ground | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoveredGame, setHoveredGame] = useState<ScheduleItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [_allGrounds, setAllGrounds] = useState<{ id: number; name: string; location: string; display_name: string }[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadGrounds();
  }, []);

  const loadGrounds = async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        // Admin sees all grounds
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
    }
  }, [selectedGround, viewMode, currentDate]);

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
            <div>
              <h1 className="text-lg font-bold">Ground Management</h1>
              <p className="text-amber-100 text-xs">Select a ground to view schedule</p>
            </div>
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
