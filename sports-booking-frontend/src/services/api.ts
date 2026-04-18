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

  googleAuth: (data: { id_token: string }) =>
    request('/api/auth/google', { method: 'POST', body: JSON.stringify(data) }),

  getProfile: () => request('/api/auth/me'),

  updateProfile: (data: {
    first_name?: string; last_name?: string; email?: string; phone?: string;
    notification_preference?: string; sports?: string[]; locations?: string[];
    sport_positions?: Record<string, string[]>; currency?: string;
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
    cost_per_person: number; payment_timing: string; duration_minutes?: number;
    payee_user_id?: number; quit_penalty_hours?: number; payment_mode?: string;
    potd_congrats_delay_minutes?: number;
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

  completeGame: (id: number, scores?: {
    team_a_score?: number; team_b_score?: number;
    goal_scorers?: { user_id: number; goals: number }[];
  }) =>
    request(`/api/games/${id}/complete`, {
      method: 'POST',
      body: scores ? JSON.stringify(scores) : JSON.stringify({}),
    }),

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

  postDiscussionMessage: (message: string, gameId?: number, parentId?: number) =>
    request('/api/discussions/messages', {
      method: 'POST',
      body: JSON.stringify({ message, game_id: gameId ?? null, parent_id: parentId ?? null }),
    }),

  deleteDiscussionMessage: (messageId: number) =>
    request(`/api/discussions/messages/${messageId}`, { method: 'DELETE' }),

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

  // Role Theme Settings
  getRoleThemes: () =>
    request('/api/preferences/role-themes'),

  updateRoleTheme: (data: {
    role: string; primary_color: string; header_bg: string;
    button_bg: string; button_hover: string; accent_color: string;
  }) =>
    request('/api/preferences/role-themes', { method: 'PUT', body: JSON.stringify(data) }),
};
