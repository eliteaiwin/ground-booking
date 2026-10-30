import type { GroundDetailsInput } from '@/lib/grounds';

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
  // Same-origin mode – strip any credentials the browser may expose in location
  if (typeof window !== 'undefined') {
    try {
      const loc = new URL(window.location.href);
      if (loc.username) {
        // The page was loaded with credentials in the URL (e.g. Basic-Auth tunnel).
        // Extract them so we can send them via Authorization header on fetch() calls,
        // since fetch() does not allow URLs that contain credentials.
        _proxyBasicAuth = _proxyBasicAuth || btoa(
          `${decodeURIComponent(loc.username)}:${decodeURIComponent(loc.password)}`,
        );
      }
      loc.username = '';
      loc.password = '';
      API_URL = loc.origin;
    } catch {
      API_URL = window.location.origin;
    }
  } else {
    API_URL = '';
  }
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

async function request(path: string, options: RequestInit = {}, retries = 2): Promise<ReturnType<typeof JSON.parse>> {
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

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(err.detail || 'Request failed');
    }

    return res.json();
  } catch (err) {
    // Retry on network errors (e.g. Render cold start timeout)
    if (retries > 0 && err instanceof TypeError && err.message.includes('fetch')) {
      await new Promise(r => setTimeout(r, 3000));
      return request(path, options, retries - 1);
    }
    throw err;
  }
}

// Auth
const uploadHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (_proxyBasicAuth) {
    headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
    if (token) headers['X-Auth-Token'] = `Bearer ${token}`;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/** Absolute URL for a backend path such as an uploaded file. */
export const backendUrl = (path: string) => `${API_URL}${path}`;

export const api = {
  register: (data: {
    first_name: string; last_name: string; phone: string; email?: string;
    password: string; notification_preference: string; sports: string[]; locations: string[];
    sport_positions?: Record<string, string[]>;
  }) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { identifier: string; password: string }) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  requestPhoneVerification: () => request('/api/auth/me/verify-phone/request', { method: 'POST' }),
  confirmPhoneVerification: (otp: string) =>
    request('/api/auth/me/verify-phone/confirm', { method: 'POST', body: JSON.stringify({ otp }) }),
  requestOTP: (data: { phone: string; country_code?: string }) =>
    request('/api/auth/otp/request', { method: 'POST', body: JSON.stringify(data) }),

  verifyOTP: (data: { phone: string; otp: string; country_code?: string }) =>
    request('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify(data) }),

  // Registration OTP (phone verification before account exists)
  requestRegistrationOTP: (data: { phone: string }) =>
    request('/api/auth/otp/request-registration', { method: 'POST', body: JSON.stringify(data) }),

  verifyRegistrationOTP: (data: { phone: string; otp: string }) =>
    request('/api/auth/otp/verify-registration', { method: 'POST', body: JSON.stringify(data) }),

  googleAuth: (data: { id_token: string }) =>
    request('/api/auth/google', { method: 'POST', body: JSON.stringify(data) }),

  appleAuth: (data: { identity_token: string; given_name?: string | null; family_name?: string | null }) =>
    request('/api/auth/apple', { method: 'POST', body: JSON.stringify(data) }),

  getProfile: () => request('/api/auth/me'),

  updateProfile: (data: {
    first_name?: string; last_name?: string; email?: string; phone?: string;
    notification_preference?: string; sports?: string[]; locations?: string[];
    sport_positions?: Record<string, string[]>; currency?: string; upi_id?: string; display_name?: string; gender?: string; date_of_birth?: string;
  }) =>
    request('/api/auth/me', { method: 'PUT', body: JSON.stringify(data) }),

  // Change password (self)
  changePassword: (data: { current_password?: string; new_password: string }) =>
    request('/api/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),

  // Forgot password
  forgotPassword: (data: { email: string }) =>
    request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),

  // Reset password with token
  resetPasswordToken: (data: { token: string; new_password: string }) =>
    request('/api/auth/reset-password-token', { method: 'POST', body: JSON.stringify(data) }),

  // Delete account (public, Play Store requirement)
  deleteAccount: (data: { phone: string; password: string; reason?: string }) =>
    request('/api/auth/delete-account', { method: 'POST', body: JSON.stringify(data) }),

  // Delete account (authenticated, from in-app settings)
  deleteAccountAuth: () =>
    request('/api/auth/delete-account-auth', { method: 'POST' }),

  // Users (admin)
  searchUsers: (filters?: { search?: string; location?: string; ground_id?: number; role?: string; sport?: string }) => {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.location) params.append('location', filters.location);
    if (filters?.ground_id) params.append('ground_id', String(filters.ground_id));
    if (filters?.role) params.append('role', filters.role);
    if (filters?.sport) params.append('sport', filters.sport);
    const qs = params.toString();
    return request(`/api/users${qs ? `?${qs}` : ''}`);
  },

  listUsers: () => request('/api/users'),

  bulkImportUsers: (data: {
    users: { first_name: string; last_name?: string; phone: string }[];
    default_password: string;
  }) =>
    request('/api/users/bulk-import', { method: 'POST', body: JSON.stringify(data) }),

  updateUserRoles: (userId: number, roles: string[]) =>
    request(`/api/users/${userId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }),

  adminUpdateUser: (userId: number, data: {
    first_name?: string; last_name?: string; email?: string; phone?: string;
    notification_preference?: string; sports?: string[]; locations?: string[];
    sport_positions?: Record<string, string[]>; currency?: string;
  }) =>
    request(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),

  adminResetPassword: (userId: number, data: { new_password: string; force_change: boolean }) =>
    request(`/api/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),

  assignGroundRole: (userId: number, data: { ground_id: number; role: string; sport_type?: string }) =>
    request(`/api/users/${userId}/ground-role`, { method: 'POST', body: JSON.stringify(data) }),

  removeGroundRole: (userId: number, assignmentType: string, assignmentId: number) =>
    request(`/api/users/${userId}/ground-role/${assignmentType}/${assignmentId}`, { method: 'DELETE' }),

  // Games
  createGame: (data: {
    title: string; sport_type: string; ground_name: string;
    game_date: string; game_time: string; max_players: number;
    ground_cost: number; payment_timing: string; duration_minutes?: number;
    payee_user_id?: number; receiver_id?: number; quit_penalty_hours?: number; payment_mode?: string;
    potd_congrats_delay_minutes?: number; note_before_players?: string; note_after_players?: string;
    pitch_format?: string; pitch_number?: number; allotment_id?: number; payment_collection?: string;
  }) => request('/api/games', { method: 'POST', body: JSON.stringify(data) }),

  createSeries: (data: {
    series_name: string; sport_type: string; ground_name: string;
    max_players: number; ground_cost: number; duration_minutes?: number;
    payee_user_id?: number; receiver_id?: number; quit_penalty_hours?: number; payment_mode?: string;
    potd_congrats_delay_minutes?: number; recurrence_days: { day: string; time: string }[];
    weeks?: number; start_date?: string; pitch_format?: string; payment_collection?: string;
  }) => request('/api/games/series', { method: 'POST', body: JSON.stringify(data) }),

  editGame: (gameId: number, data: {
    title?: string; sport_type?: string; ground_name?: string;
    game_date?: string; game_time?: string; max_players?: number;
    ground_cost?: number; cost_per_person?: number; duration_minutes?: number;
    payee_user_id?: number; receiver_id?: number; quit_penalty_hours?: number; payment_mode?: string;
    note_before_players?: string; note_after_players?: string; payment_collection?: string;
  }) => request(`/api/games/${gameId}`, { method: 'PUT', body: JSON.stringify(data) }),

  listGames: (status?: string) =>
    request(`/api/games${status ? `?status=${status}` : ''}`),

  getGame: (id: number) => request(`/api/games/${id}`),

  openVoting: (id: number) =>
    request(`/api/games/${id}/open-voting`, { method: 'POST' }),

  voteJoin: (id: number, position?: string, tentative?: boolean) =>
    request(`/api/games/${id}/vote`, { method: 'POST', body: JSON.stringify({ position: position || '', tentative: !!tentative }) }),

  confirmAvailability: (id: number) =>
    request(`/api/games/${id}/confirm-availability`, { method: 'POST' }),

  quitGame: (id: number) =>
    request(`/api/games/${id}/vote`, { method: 'DELETE' }),

  checkQuitPenalty: (gameId: number) =>
    request(`/api/games/${gameId}/quit-penalty-check`),

  nominatePlayer: (gameId: number, userId: number, position?: string) =>
    request(`/api/games/${gameId}/nominate`, { method: 'POST', body: JSON.stringify({ user_id: userId, position: position || '' }) }),

  startGame: (gameId: number) =>
    request(`/api/games/${gameId}/start`, { method: 'POST' }),

  removePlayer: (gameId: number, userId: number) =>
    request(`/api/games/${gameId}/players/${userId}`, { method: 'DELETE' }),

  completeGame: (id: number, payload?: {
    played_user_ids?: number[];
    team_a_score?: number; team_b_score?: number;
    goal_scorers?: { user_id: number; goals: number; own_goals?: number }[];
  }) =>
    request(`/api/games/${id}/complete`, {
      method: 'POST',
      body: payload ? JSON.stringify(payload) : JSON.stringify({}),
    }),

  editCompletedGame: (id: number, payload: {
    played_user_ids: number[];
    team_scores?: { team_id: number; score: number }[];
    team_assignments?: Record<number, number | null>;
    goal_scorers?: { user_id: number; goals: number; own_goals: number }[];
  }) =>
    request(`/api/games/${id}/edit-result`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cancelGamePreview: (id: number) =>
    request(`/api/games/${id}/cancel-preview`),

  cancelGame: (id: number) =>
    request(`/api/games/${id}/cancel`, { method: 'POST' }),

  deleteGame: (id: number) =>
    request(`/api/games/${id}`, { method: 'DELETE' }),

  votePOTD: (gameId: number, playerId: number) =>
    request(`/api/games/${gameId}/vote-potd`, { method: 'POST', body: JSON.stringify({ player_id: playerId }) }),

  getPOTD: (gameId: number) =>
    request(`/api/games/${gameId}/potd`),

  broadcastStatus: (gameId: number) =>
    request(`/api/games/${gameId}/broadcast-status`, { method: 'POST' }),

  setPayFirst: (userId: number, payFirst: boolean) =>
    request(`/api/auth/user/${userId}/pay-first`, { method: 'PUT', body: JSON.stringify({ pay_first: payFirst }) }),

  markPaymentMade: (gameId: number, userId: number) =>
    request(`/api/games/${gameId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, game_id: gameId }),
    }),

  remindUnpaid: (gameId: number) =>
    request(`/api/games/${gameId}/remind-unpaid`, { method: 'POST' }),

  // Teams
  createTeams: (gameId: number, teamNames: string[], jerseyColors: string[] = []) =>
    request(`/api/games/${gameId}/teams`, { method: 'POST', body: JSON.stringify({ team_names: teamNames, jersey_colors: jerseyColors }) }),

  setTeamJersey: (gameId: number, teamId: number, jerseyColor: string) =>
    request(`/api/games/${gameId}/teams/${teamId}/jersey`, { method: 'PUT', body: JSON.stringify({ jersey_color: jerseyColor }) }),

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

  getGameLog: (gameId: number) => request(`/api/games/${gameId}/log`),

  getPaymentHistory: (userId: number, gameId?: number) =>
    request(`/api/payments/history/${userId}${gameId ? `?game_id=${gameId}` : ''}`),

  settlePaymentOffline: (userId: number, gameId: number, comment = '') =>
    request(`/api/payments/history/${userId}/settle`, { method: 'POST', body: JSON.stringify({ game_id: gameId, comment }) }),

  remindPayment: (userId: number, gameId: number) =>
    request(`/api/payments/history/${userId}/remind`, { method: 'POST', body: JSON.stringify({ game_id: gameId }) }),

  settleExcess: (gameId: number, userId: number) =>
    request(`/api/games/${gameId}/settle-excess`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  markPaidWithComment: (gameId: number, userId: number, comment: string) =>
    request('/api/payments/mark-paid-with-comment', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, user_id: userId, comment }),
    }),

  getSettlements: () => request('/api/payments/settlements'),

  // Online payments (Cashfree Easy Split)
  getGatewayInfo: () => request('/api/payments/gateway'),
  getPayoutAccount: () => request('/api/payments/payout-account'),
  savePayoutAccount: (data: { upi_id: string; account_holder: string; pan?: string }) =>
    request('/api/payments/payout-account', { method: 'PUT', body: JSON.stringify(data) }),
  createPaymentOrder: (gameId: number) =>
    request('/api/payments/orders', { method: 'POST', body: JSON.stringify({ game_id: gameId }) }),
  verifyPaymentOrder: (orderId: string) =>
    request(`/api/payments/orders/${encodeURIComponent(orderId)}/verify`, { method: 'POST' }),

  // Notifications
  getNotifications: () => request('/api/notifications'),

  markRead: (id: number) =>
    request(`/api/notifications/${id}/read`, { method: 'PUT' }),

  markAllRead: () =>
    request('/api/notifications/read-all', { method: 'PUT' }),

  // Preferences & App Settings
  getPreferences: () => request('/api/preferences'),
  getAppSettings: () => request('/api/users/app-settings'),
  updateAppSettings: (data: {
    payments_enabled?: boolean; payment_surcharge_percent?: number; payment_gst_percent?: number;
    payment_dev_share_percent?: number; payment_app_fee_gst_percent?: number;
    enabled_sports?: string[]; player_name_display?: string;
  }) =>
    request('/api/users/app-settings', { method: 'PUT', body: JSON.stringify(data) }),

  updatePreference: (sportType: string, defaultMaxPlayers: number) =>
    request('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ sport_type: sportType, default_max_players: defaultMaxPlayers }),
    }),

  getGameDefaults: () => request('/api/preferences/game-defaults'),
  getPayFirstPlayers: () => request('/api/preferences/pay-first-players'),
  updateGameDefaults: (data: {
    default_payee_user_id?: number; default_quit_penalty_hours?: number;
    default_potd_delay_minutes?: number; allow_position_selection?: boolean; show_quit_penalty?: boolean;
    pay_first_enabled?: boolean;
    default_payment_collection?: string; roster_edit_days?: number; late_quit_hours?: number;
  }) =>
    request('/api/preferences/game-defaults', { method: 'PUT', body: JSON.stringify(data) }),

  getPreferenceForSport: (sportType: string) =>
    request(`/api/preferences/${sportType}`),

  // Locations & Grounds
  listLocations: () => request('/api/locations'),

  addLocation: (name: string) =>
    request('/api/locations', { method: 'POST', body: JSON.stringify({ name }) }),

  listGrounds: (location?: string) =>
    request(`/api/locations/grounds${location ? `?location=${encodeURIComponent(location)}` : ''}`),

  addGround: (name: string, location: string, moderatorUserIds?: number[]) =>
    request('/api/locations/grounds', { method: 'POST', body: JSON.stringify({ name, location, moderator_user_ids: moderatorUserIds || [] }) }),

  usersByLocation: (location: string, search?: string) => {
    const params = new URLSearchParams({ location });
    if (search) params.append('search', search);
    return request(`/api/locations/users-by-location?${params.toString()}`);
  },

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
    date?: string; date_from?: string; date_to?: string;
    ground?: string; location?: string; status?: string; sport?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.date) params.append('date', filters.date);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (filters?.ground) params.append('ground', filters.ground);
    if (filters?.location) params.append('location', filters.location);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.sport) params.append('sport', filters.sport);
    const qs = params.toString();
    return request(`/api/games/search/games${qs ? `?${qs}` : ''}`);
  },

  // Discussion
  getDiscussionMessages: (gameId?: number, limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (gameId !== undefined) params.append('game_id', String(gameId));
    if (limit) params.append('limit', String(limit));
    if (offset) params.append('offset', String(offset));
    const qs = params.toString();
    return request(`/api/discussions/messages${qs ? `?${qs}` : ''}`);
  },

  postDiscussionMessage: (message: string, gameId?: number, parentId?: number, mentionUserIds: number[] = []) =>
    request('/api/discussions/messages', {
      method: 'POST',
      body: JSON.stringify({ message, game_id: gameId ?? null, parent_id: parentId ?? null, mention_user_ids: mentionUserIds }),
    }),

  deleteDiscussionMessage: (messageId: number) =>
    request(`/api/discussions/messages/${messageId}`, { method: 'DELETE' }),

  postMessageWithMedia: (file: File, message: string, gameId?: number, parentId?: number, addToGallery = false, mentionUserIds: number[] = []) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('message', message);
    if (gameId) formData.append('game_id', String(gameId));
    if (parentId) formData.append('parent_id', String(parentId));
    formData.append('add_to_gallery', addToGallery ? 'true' : 'false');
    formData.append('mention_user_ids', mentionUserIds.join(','));
    return fetch(`${API_URL}/api/discussions/messages/with-media`, { method: 'POST', headers: uploadHeaders(), body: formData })
      .then(async (res) => {
        const body = await res.json().catch(() => ({ detail: 'Upload failed' }));
        if (!res.ok) throw new Error(body.detail || 'Upload failed');
        return body;
      });
  },

  setMediaGallery: (mediaId: number, inGallery: boolean) =>
    request(`/api/discussions/media/${mediaId}/gallery`, { method: 'PUT', body: JSON.stringify({ in_gallery: inGallery }) }),

  deleteMedia: (mediaId: number) =>
    request(`/api/discussions/media/${mediaId}`, { method: 'DELETE' }),

  getAppLinks: () => request('/api/preferences/app-links'),

  updateAppLinks: (links: { play_store_url: string; app_store_url: string }) =>
    request('/api/preferences/app-links', { method: 'PUT', body: JSON.stringify(links) }),

  getDiscussionStorage: () =>
    request('/api/discussions/storage'),

  cleanupDiscussions: (body: { older_than_days?: number; game_id?: number; what: 'all' | 'messages' | 'media' }) =>
    request('/api/discussions/cleanup', { method: 'POST', body: JSON.stringify(body) }),

  getDiscussionMedia: (gameId: number) =>
    request(`/api/discussions/media?game_id=${gameId}`),

  uploadMedia: (gameId: number, file: File, mediaType: string, caption: string) => {
    const formData = new FormData();
    formData.append('game_id', String(gameId));
    formData.append('file', file);
    formData.append('media_type', mediaType);
    formData.append('caption', caption);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (_proxyBasicAuth) {
      headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
      if (token) headers['X-Auth-Token'] = `Bearer ${token}`;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(`${API_URL}/api/discussions/media/upload`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || 'Upload failed');
      }
      return res.json();
    });
  },

  markPaidWithProof: (gameId: number, file: File) => {
    const formData = new FormData();
    formData.append('game_id', String(gameId));
    formData.append('file', file);
    return fetch(`${API_URL}/api/payments/pay-with-proof`, { method: 'POST', headers: uploadHeaders(), body: formData })
      .then(async (res) => {
        const body = await res.json().catch(() => ({ detail: 'Upload failed' }));
        if (!res.ok) throw new Error(body.detail || 'Upload failed');
        return body as { message: string };
      });
  },

  /** Object URL of a player's payment screenshot (revoke when done). */
  getPaymentProof: (gameId: number, userId: number) =>
    fetch(`${API_URL}/api/payments/proof/${gameId}/${userId}`, { headers: uploadHeaders() }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Screenshot not found' }));
        throw new Error(err.detail || 'Screenshot not found');
      }
      return URL.createObjectURL(await res.blob());
    }),

  getMediaComments: (mediaId: number) =>
    request(`/api/discussions/media/${mediaId}/comments`),

  postMediaComment: (mediaId: number, comment: string, parentId?: number) =>
    request(`/api/discussions/media/${mediaId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ comment, parent_id: parentId ?? null }),
    }),

  toggleReaction: (targetType: string, targetId: number, emoji: string) =>
    request('/api/discussions/reactions', {
      method: 'POST',
      body: JSON.stringify({ target_type: targetType, target_id: targetId, emoji }),
    }),

  // Ground Management Assignments
  listGroundManagementAssignments: () =>
    request('/api/locations/ground-management-assignments'),

  assignGroundManagement: (userId: number, groundId: number) =>
    request('/api/locations/ground-management-assignments', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ground_id: groundId }),
    }),

  removeGroundManagementAssignment: (assignmentId: number) =>
    request(`/api/locations/ground-management-assignments/${assignmentId}`, { method: 'DELETE' }),

  // Ground Schedule (Gantt chart data)
  getGroundSchedule: (groundId: number, startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const qs = params.toString();
    return request(`/api/locations/grounds/${groundId}/schedule${qs ? `?${qs}` : ''}`);
  },

  // My Managed Grounds
  myManagedGrounds: () => request('/api/locations/my-managed-grounds'),

  // Payment receivers (wallets players pay to)
  listReceivers: () => request('/api/receivers'),
  receiversForGround: (groundName: string) =>
    request(`/api/receivers/for-ground?ground_name=${encodeURIComponent(groundName)}`),
  createReceiver: (data: { nick_name: string; methods: { kind: string; value: string }[]; ground_ids: number[]; user_id?: number }) =>
    request('/api/receivers', { method: 'POST', body: JSON.stringify(data) }),
  updateReceiver: (id: number, data: { nick_name: string; methods: { kind: string; value: string }[]; ground_ids: number[]; user_id?: number }) =>
    request(`/api/receivers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReceiver: (id: number) => request(`/api/receivers/${id}`, { method: 'DELETE' }),
  searchReceiverUsers: (q: string) => request(`/api/receivers/users?q=${encodeURIComponent(q)}`),
  myReceiverGames: () => request('/api/receivers/my-games'),
  confirmReceived: (gameId: number, playerId: number, received: boolean) =>
    request(`/api/receivers/games/${gameId}/players/${playerId}/received`, { method: 'POST', body: JSON.stringify({ received }) }),

  // Enhanced POTD voting (ranked)
  voteRankedPOTD: (gameId: number, first: number, second?: number, third?: number) =>
    request(`/api/games/${gameId}/vote-potd`, {
      method: 'POST',
      body: JSON.stringify({
        first_preference: first,
        ...(second !== undefined && { second_preference: second }),
        ...(third !== undefined && { third_preference: third }),
      }),
    }),

  // Hall of Fame
  getHallOfFame: (sport?: string) => {
    const qs = sport ? `?sport=${encodeURIComponent(sport)}` : '';
    return request(`/api/games/hall-of-fame${qs}`);
  },

  // Player Stats
  getPlayerStats: (playerId: number) =>
    request(`/api/games/player/${playerId}/stats`),

  getPlayerInsights: (playerId: number) =>
    request(`/api/games/player/${playerId}/insights`),

  // Profile Picture Upload
  uploadProfilePic: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (_proxyBasicAuth) {
      headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
      if (token) headers['X-Auth-Token'] = `Bearer ${token}`;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(`${API_URL}/api/auth/me/profile-pic`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || 'Upload failed');
      }
      return res.json();
    });
  },

  getProfilePicUrl: (filename: string) =>
    `${API_URL}/api/auth/profile-pic/${filename}`,

  // User Photos (multi-photo with sport assignment)
  uploadUserPhoto: async (file: File, purpose: string = 'profile') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (_proxyBasicAuth) {
      headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
      if (token) headers['X-Auth-Token'] = `Bearer ${token}`;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}/api/auth/me/photos`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  listUserPhotos: () =>
    request('/api/auth/me/photos'),

  updatePhotoPurpose: (photoId: number, purpose: string) =>
    request(`/api/auth/me/photos/${photoId}/purpose?purpose=${encodeURIComponent(purpose)}`, { method: 'PUT' }),

  deleteUserPhoto: (photoId: number) =>
    request(`/api/auth/me/photos/${photoId}`, { method: 'DELETE' }),

  getUserPhotos: (userId: number) =>
    request(`/api/auth/user/${userId}/photos`),

  getUserSummary: (userId: number) =>
    request(`/api/auth/user/${userId}/summary`),

  getUserSportPhoto: (userId: number, sport: string) =>
    request(`/api/auth/user/${userId}/sport-photo/${encodeURIComponent(sport)}`),

  // User Persona
  getUserPersona: (userId: number) =>
    request(`/api/auth/user/${userId}/persona`),

  // Ground Join Requests
  requestJoinGround: (groundId: number, sports: string, message: string) =>
    request(`/api/locations/grounds/${groundId}/join-request`, {
      method: 'POST',
      body: JSON.stringify({ ground_id: groundId, sports, message }),
    }),

  listJoinRequests: (groundId: number, statusFilter?: string) => {
    const qs = statusFilter ? `?status_filter=${statusFilter}` : '';
    return request(`/api/locations/grounds/${groundId}/join-requests${qs}`);
  },

  approveJoinRequest: (groundId: number, requestId: number, assignedRole: string, maxNominations: number = 0) =>
    request(`/api/locations/grounds/${groundId}/join-request/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ assigned_role: assignedRole, max_nominations: maxNominations }),
    }),

  rejectJoinRequest: (groundId: number, requestId: number) =>
    request(`/api/locations/grounds/${groundId}/join-request/${requestId}/reject`, {
      method: 'POST',
    }),

  listGroundMembers: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}/members`),

  // Ground-level moderator management (accessible by moderators of that ground)
  listGroundModerators: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}/moderators`),

  addGroundModerator: (groundId: number, userId: number, sportType: string = '') =>
    request(`/api/locations/grounds/${groundId}/moderators`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, sport_type: sportType }),
    }),

  removeGroundModerator: (groundId: number, assignmentId: number) =>
    request(`/api/locations/grounds/${groundId}/moderators/${assignmentId}`, { method: 'DELETE' }),

  // Admin: Disable/Enable User
  disableUser: (userId: number, reason: string = '') =>
    request(`/api/users/${userId}/disable`, { method: 'POST', body: JSON.stringify({ reason }) }),

  enableUser: (userId: number) =>
    request(`/api/users/${userId}/enable`, { method: 'POST' }),

  // Moderator: Block/Unblock User for Ground
  blockUserForGround: (groundId: number, userId: number, reason: string = '') =>
    request(`/api/locations/grounds/${groundId}/block-user`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, reason }),
    }),

  unblockUserForGround: (groundId: number, userId: number) =>
    request(`/api/locations/grounds/${groundId}/unblock-user`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  listBlockedUsers: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}/blocked-users`),

  // Ground Photos
  listGroundPhotos: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}/photos`),

  uploadGroundPhoto: async (groundId: number, file: File, caption: string = '') => {
    const formData = new FormData();
    formData.append('file', file);
    if (caption) formData.append('caption', caption);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (_proxyBasicAuth) {
      headers['Authorization'] = `Basic ${_proxyBasicAuth}`;
      if (token) headers['X-Auth-Token'] = `Bearer ${token}`;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}/api/locations/grounds/${groundId}/photos`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },

  setMainGroundPhoto: (groundId: number, photoId: number) =>
    request(`/api/locations/grounds/${groundId}/photos/${photoId}/set-main`, { method: 'PUT' }),

  deleteGroundPhoto: (groundId: number, photoId: number) =>
    request(`/api/locations/grounds/${groundId}/photos/${photoId}`, { method: 'DELETE' }),

  getGroundPhotoUrl: (filename: string) => {
    return `${API_URL}/api/locations/grounds/photo/${filename}`;
  },

  // Direct Voting Link
  getVotingLink: (gameId: number) =>
    request(`/api/games/${gameId}/voting-link`),

  resolveVotingToken: (token: string) =>
    request(`/api/games/vote/${token}`),

  // Notification Settings
  getNotificationSettings: () =>
    request('/api/notifications/settings'),

  updateNotificationSettings: (settings: Record<string, unknown>) =>
    request('/api/notifications/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getGroundAlertPauses: () =>
    request('/api/notifications/ground-pauses'),

  setGroundAlertPause: (groundId: number, sportType: string, paused: boolean) =>
    request('/api/notifications/ground-pauses', {
      method: 'POST',
      body: JSON.stringify({ ground_id: groundId, sport_type: sportType, paused }),
    }),

  removeGroundAlertPause: (pauseId: number) =>
    request(`/api/notifications/ground-pauses/${pauseId}`, { method: 'DELETE' }),

  getMyGroundsForNotifications: () =>
    request('/api/notifications/my-grounds'),

  getModeratorOverrides: (groundId: number) =>
    request(`/api/notifications/moderator-overrides/${groundId}`),

  setModeratorAlertOverride: (userId: number, groundId: number, overrides: Record<string, boolean>) =>
    request('/api/notifications/moderator-overrides', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ground_id: groundId, ...overrides }),
    }),

  trackPaymentReminder: (gameId: number, targetUserId: number) =>
    request(`/api/notifications/payment-reminder/${gameId}/${targetUserId}`, { method: 'POST' }),

  getPaymentReminders: (gameId: number) =>
    request(`/api/notifications/payment-reminders/${gameId}`),

  // Ground details, nearby & owner self-registration
  getGroundDetails: (groundId: number) =>
    request(`/api/locations/grounds/${groundId}/details`),

  updateGroundDetails: (groundId: number, data: GroundDetailsInput) =>
    request(`/api/locations/grounds/${groundId}/details`, { method: 'PUT', body: JSON.stringify(data) }),

  nearbyGrounds: (lat: number, lng: number, sport?: string) => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (sport) params.append('sport', sport);
    return request(`/api/locations/grounds/nearby?${params.toString()}`);
  },

  registerGround: (data: GroundDetailsInput & { name: string; location: string }) =>
    request('/api/locations/grounds/register', { method: 'POST', body: JSON.stringify(data) }),

  myGroundRegistrations: () => request('/api/locations/my-ground-registrations'),

  getRegisterAccess: () => request('/api/locations/ground-register-access'),
  requestRegisterAccess: (note: string) =>
    request('/api/locations/ground-register-access/request', { method: 'POST', body: JSON.stringify({ note }) }),
  listRegisterRequests: () => request('/api/locations/ground-register-requests'),
  approveRegisterRequest: (id: number) =>
    request(`/api/locations/ground-register-requests/${id}/approve`, { method: 'POST' }),
  rejectRegisterRequest: (id: number, reason: string) =>
    request(`/api/locations/ground-register-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  listPendingGrounds: () => request('/api/locations/grounds/pending'),

  approveGround: (groundId: number, managerUserIds: number[]) =>
    request(`/api/locations/grounds/${groundId}/approve`, { method: 'POST', body: JSON.stringify({ manager_user_ids: managerUserIds }) }),

  rejectGround: (groundId: number, reason: string) =>
    request(`/api/locations/grounds/${groundId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Pitch allotments & moderator groups
  listModeratorGroups: (groundId: number) => request(`/api/allotments/grounds/${groundId}/groups`),
  createModeratorGroup: (groundId: number, name: string, parentId: number | null = null) =>
    request(`/api/allotments/grounds/${groundId}/groups`, { method: 'POST', body: JSON.stringify({ name, parent_id: parentId }) }),
  setModeratorGroupParent: (groupId: number, parentId: number | null) =>
    request(`/api/allotments/groups/${groupId}/parent`, { method: 'PUT', body: JSON.stringify({ parent_id: parentId }) }),
  renameModeratorGroup: (groupId: number, name: string) =>
    request(`/api/allotments/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteModeratorGroup: (groupId: number) =>
    request(`/api/allotments/groups/${groupId}`, { method: 'DELETE' }),
  addModeratorGroupMember: (groupId: number, userId: number) =>
    request(`/api/allotments/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  removeModeratorGroupMember: (groupId: number, memberId: number) =>
    request(`/api/allotments/groups/${groupId}/members/${memberId}`, { method: 'DELETE' }),
  allotGame: (gameId: number) =>
    request(`/api/allotments/games/${gameId}/allot`, { method: 'POST' }),

  resolveMapsUrl: (url: string) =>
    request(`/api/locations/maps/resolve`, { method: 'POST', body: JSON.stringify({ url }) }),

  getGroundOccupancy: (groundId: number, date: string, sport: string) =>
    request(`/api/allotments/grounds/${groundId}/occupancy?date=${date}&sport=${encodeURIComponent(sport)}`),
  createAllotment: (groundId: number, data: {
    sport_type: string; allot_date: string; start_time: string; duration_minutes: number;
    pitch_format?: string; pitch_number?: number; moderator_user_id?: number; moderator_group_id?: number;
    rent?: number; repeat_weeks?: number; notes?: string; until_date?: string; weekdays?: number[];
  }) => request(`/api/allotments/grounds/${groundId}/allotments`, { method: 'POST', body: JSON.stringify(data) }),
  updateAllotment: (allotmentId: number, data: { rent?: number; rent_paid?: boolean; notes?: string }) =>
    request(`/api/allotments/${allotmentId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  cancelAllotment: (allotmentId: number, series: boolean) =>
    request(`/api/allotments/${allotmentId}?series=${series}`, { method: 'DELETE' }),
  myAllotments: () => request('/api/allotments/mine'),

  // Role Theme Settings
  getRoleThemes: () =>
    request('/api/preferences/role-themes'),

  updateRoleTheme: (data: {
    role: string; primary_color: string; header_bg: string;
    button_bg: string; button_hover: string; accent_color: string;
  }) =>
    request('/api/preferences/role-themes', { method: 'PUT', body: JSON.stringify(data) }),
};
