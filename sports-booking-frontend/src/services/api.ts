// Determine API URL and optional proxy Basic-Auth credentials.
//
// Proxy-auth mode (behind a Basic-Auth tunnel like the Devin expose tool):
//   VITE_API_URL = ""            (same-origin, served via STATIC_DIR)
//   VITE_PROXY_AUTH = "user:pass" (proxy credentials)
// The frontend sends Authorization: Basic (for the proxy) on every request,
// and X-Auth-Token: Bearer (for the backend JWT) on authenticated requests.
//
// Alternatively, VITE_API_URL can embed credentials (https://user:pass@host)
// which are extracted and used the same way.
//
// Normal mode (no proxy):
//   VITE_API_URL = "http://localhost:8000"  or a deployed backend URL
//   JWT goes in Authorization: Bearer as usual.
const _rawApiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
let API_URL: string;
let _proxyBasicAuth: string | null = null;

// Check for explicit proxy auth env var first
const _proxyAuthEnv = import.meta.env.VITE_PROXY_AUTH ?? '';
if (_proxyAuthEnv) {
  _proxyBasicAuth = btoa(_proxyAuthEnv);
}

if (!_rawApiUrl) {
  // Same-origin mode
  API_URL = typeof window !== 'undefined' ? window.location.origin : '';
} else {
  try {
    const parsed = new URL(_rawApiUrl);
    if (parsed.username) {
      _proxyBasicAuth = btoa(
        `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
      );
      parsed.username = '';
      parsed.password = '';
    }
    API_URL = parsed.origin + parsed.pathname.replace(/\/$/, '');
  } catch {
    API_URL = _rawApiUrl;
  }
}

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (_proxyBasicAuth) {
    // Proxy mode: Basic Auth goes in Authorization, JWT in X-Auth-Token
    headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
    if (token) {
      headers['X-Auth-Token'] = `Bearer ${token}`;
    }
  } else if (token) {
    // Normal mode: JWT in Authorization
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || 'Request failed');
  }

  return res.json();
}

// Auth
export const api = {
  register: (data: {
    first_name: string; last_name: string; phone: string; email?: string;
    password: string; notification_preference: string; sports: string[]; locations: string[];
    sport_positions?: Record<string, string[]>;
  }) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { phone: string; password: string }) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  requestOTP: (data: { phone: string }) =>
    request('/api/auth/otp/request', { method: 'POST', body: JSON.stringify(data) }),

  verifyOTP: (data: { phone: string; otp: string }) =>
    request('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify(data) }),

  googleAuth: (data: { google_id: string; email: string; first_name: string; last_name: string }) =>
    request('/api/auth/google', { method: 'POST', body: JSON.stringify(data) }),

  getProfile: () => request('/api/auth/me'),

  updateProfile: (data: {
    first_name?: string; last_name?: string; email?: string; phone?: string;
    notification_preference?: string; sports?: string[]; locations?: string[];
    sport_positions?: Record<string, string[]>; currency?: string;
  }) =>
    request('/api/auth/me', { method: 'PUT', body: JSON.stringify(data) }),

  // Users
  listUsers: () => request('/api/users'),

  updateUserRoles: (userId: number, roles: string[]) =>
    request(`/api/users/${userId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }),

  // Games
  createGame: (data: {
    title: string; sport_type: string; ground_name: string;
    game_date: string; game_time: string; max_players: number;
    cost_per_person: number; payment_timing: string; duration_minutes?: number;
    payee_user_id?: number; quit_penalty_hours?: number; payment_mode?: string;
  }) => request('/api/games', { method: 'POST', body: JSON.stringify(data) }),

  editGame: (gameId: number, data: {
    title?: string; sport_type?: string; ground_name?: string;
    game_date?: string; game_time?: string; max_players?: number;
    cost_per_person?: number; duration_minutes?: number;
    payee_user_id?: number; quit_penalty_hours?: number; payment_mode?: string;
  }) => request(`/api/games/${gameId}`, { method: 'PUT', body: JSON.stringify(data) }),

  listGames: (status?: string) =>
    request(`/api/games${status ? `?status=${status}` : ''}`),

  getGame: (id: number) => request(`/api/games/${id}`),

  openVoting: (id: number) =>
    request(`/api/games/${id}/open-voting`, { method: 'POST' }),

  voteJoin: (id: number, position?: string) =>
    request(`/api/games/${id}/vote`, { method: 'POST', body: JSON.stringify({ position: position || '' }) }),

  quitGame: (id: number) =>
    request(`/api/games/${id}/vote`, { method: 'DELETE' }),

  checkQuitPenalty: (gameId: number) =>
    request(`/api/games/${gameId}/quit-penalty-check`),

  nominatePlayer: (gameId: number, userId: number, position?: string) =>
    request(`/api/games/${gameId}/nominate`, { method: 'POST', body: JSON.stringify({ user_id: userId, position: position || '' }) }),

  startGame: (gameId: number) =>
    request(`/api/games/${gameId}/start`, { method: 'POST' }),

  completeGame: (id: number) =>
    request(`/api/games/${id}/complete`, { method: 'POST' }),

  cancelGamePreview: (id: number) =>
    request(`/api/games/${id}/cancel-preview`),

  cancelGame: (id: number) =>
    request(`/api/games/${id}/cancel`, { method: 'POST' }),

  votePOTD: (gameId: number, playerId: number) =>
    request(`/api/games/${gameId}/vote-potd`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),

  getPOTD: (gameId: number) =>
    request(`/api/games/${gameId}/potd`),

  broadcastStatus: (gameId: number) =>
    request(`/api/games/${gameId}/broadcast-status`, { method: 'POST' }),

  markPaymentMade: (gameId: number, userId: number) =>
    request(`/api/games/${gameId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, game_id: gameId }),
    }),

  remindUnpaid: (gameId: number) =>
    request(`/api/games/${gameId}/remind-unpaid`, { method: 'POST' }),

  // Teams
  createTeams: (gameId: number, teamNames: string[]) =>
    request(`/api/games/${gameId}/teams`, { method: 'POST', body: JSON.stringify({ team_names: teamNames }) }),

  movePlayerToTeam: (gameId: number, playerUserId: number, teamId: number | null) =>
    request(`/api/games/${gameId}/teams/move-player`, {
      method: 'POST',
      body: JSON.stringify({ player_user_id: playerUserId, team_id: teamId }),
    }),

  deleteTeams: (gameId: number) =>
    request(`/api/games/${gameId}/teams`, { method: 'DELETE' }),

  // Payments
  recordPayment: (gameId: number) =>
    request('/api/payments/pay', { method: 'POST', body: JSON.stringify({ game_id: gameId }) }),

  myPayments: () => request('/api/payments/my'),

  paymentSummary: (filters?: {
    payment_status?: string; game_status?: string; date_range?: string; game_id?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.payment_status) params.append('payment_status', filters.payment_status);
    if (filters?.game_status) params.append('game_status', filters.game_status);
    if (filters?.date_range) params.append('date_range', filters.date_range);
    if (filters?.game_id) params.append('game_id', String(filters.game_id));
    const qs = params.toString();
    return request(`/api/payments/summary${qs ? `?${qs}` : ''}`);
  },

  markPaidWithComment: (gameId: number, userId: number, comment: string) =>
    request('/api/payments/mark-paid-with-comment', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, user_id: userId, comment }),
    }),

  getSettlements: () => request('/api/payments/settlements'),

  // Notifications
  getNotifications: () => request('/api/notifications'),

  markRead: (id: number) =>
    request(`/api/notifications/${id}/read`, { method: 'PUT' }),

  markAllRead: () =>
    request('/api/notifications/read-all', { method: 'PUT' }),

  // Preferences
  getPreferences: () => request('/api/preferences'),

  updatePreference: (sportType: string, defaultMaxPlayers: number) =>
    request('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ sport_type: sportType, default_max_players: defaultMaxPlayers }),
    }),

  getPreferenceForSport: (sportType: string) =>
    request(`/api/preferences/${sportType}`),

  // Locations & Grounds
  listLocations: () => request('/api/locations'),

  addLocation: (name: string) =>
    request('/api/locations', { method: 'POST', body: JSON.stringify({ name }) }),

  listGrounds: (location?: string) =>
    request(`/api/locations/grounds${location ? `?location=${encodeURIComponent(location)}` : ''}`),

  addGround: (name: string, location: string) =>
    request('/api/locations/grounds', { method: 'POST', body: JSON.stringify({ name, location }) }),

  renameLocation: (locationId: number, newName: string) =>
    request(`/api/locations/${locationId}/rename`, { method: 'PUT', body: JSON.stringify({ new_name: newName }) }),

  renameGround: (groundId: number, newName: string) =>
    request(`/api/locations/grounds/${groundId}/rename`, { method: 'PUT', body: JSON.stringify({ new_name: newName }) }),

  deleteGround: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}`, { method: 'DELETE' }),

  getGroundPlayers: (groundId: number, sportType?: string) => {
    const params = new URLSearchParams();
    if (sportType) params.append('sport_type', sportType);
    const qs = params.toString();
    return request(`/api/locations/grounds/${groundId}/players${qs ? `?${qs}` : ''}`);
  },

  // Moderator-Location assignments
  listModeratorAssignments: (location?: string) =>
    request(`/api/locations/moderator-assignments${location ? `?location=${encodeURIComponent(location)}` : ''}`),

  assignModeratorLocation: (userId: number, location: string, groundName: string, sportType: string) =>
    request('/api/locations/moderator-assignments', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, location, ground_name: groundName, sport_type: sportType }),
    }),

  removeModeratorAssignment: (assignmentId: number) =>
    request(`/api/locations/moderator-assignments/${assignmentId}`, { method: 'DELETE' }),

  // Search grounds with moderators (public)
  searchGrounds: (location?: string, groundName?: string) => {
    const params = new URLSearchParams();
    if (location) params.append('location', location);
    if (groundName) params.append('ground_name', groundName);
    const qs = params.toString();
    return request(`/api/locations/grounds/search${qs ? `?${qs}` : ''}`);
  },

  // Check first-time on ground
  checkFirstTimeOnGround: (gameId: number) =>
    request(`/api/games/${gameId}/check-first-time`),

  // Game search
  searchGames: (filters?: {
    date?: string; ground?: string; status?: string; sport?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.date) params.append('date', filters.date);
    if (filters?.ground) params.append('ground', filters.ground);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.sport) params.append('sport', filters.sport);
    const qs = params.toString();
    return request(`/api/games/search/games${qs ? `?${qs}` : ''}`);
  },
};
