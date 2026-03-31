import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

interface User {
  id: number;
  user_code: string;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  email: string | null;
  notification_preference: string;
  sports: string[];
  locations: string[];
  sport_positions: Record<string, string[]>;
  currency: string;
  phone_verified: number;
  profile_pic: string;
  roles: string[];
  created_at: string;
}

export interface StoredAccount {
  token: string;
  userId: number;
  name: string;
  phone: string;
  roles: string[];
}

interface RegisterData {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  password: string;
  notification_preference: string;
  sports: string[];
  locations: string[];
  sport_positions?: Record<string, string[]>;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  loginWithOTP: (phone: string, otp: string) => Promise<void>;
  requestOTP: (phone: string) => Promise<{ otp_demo?: string }>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAdmin: boolean;
  isModerator: boolean;
  isGroundManagement: boolean;
  isReadOnly: boolean;
  // Active role switching
  activeRole: string;
  switchRole: (role: string) => void;
  // Multi-account support
  storedAccounts: StoredAccount[];
  switchAccount: (userId: number) => Promise<void>;
  addAccount: (phone: string, password: string) => Promise<void>;
  removeAccount: (userId: number) => void;
  isAddingAccount: boolean;
  setIsAddingAccount: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACTIVE_ACCOUNT_KEY = 'active_account_id';
const ACTIVE_ROLE_KEY = 'active_role';

// Per-user account storage: each user has their own list of added accounts
function accountsKeyFor(userId: number): string {
  return `stored_accounts_${userId}`;
}

function getStoredAccountsFor(ownerUserId: number): StoredAccount[] {
  try {
    const raw = localStorage.getItem(accountsKeyFor(ownerUserId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredAccountsFor(ownerUserId: number, accounts: StoredAccount[]) {
  localStorage.setItem(accountsKeyFor(ownerUserId), JSON.stringify(accounts));
}

// Migrate legacy shared storage to per-user storage on first load
function migrateLegacyAccounts() {
  const legacyKey = 'stored_accounts';
  const raw = localStorage.getItem(legacyKey);
  if (!raw) return;
  try {
    const accounts: StoredAccount[] = JSON.parse(raw);
    const activeId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    if (activeId && accounts.length > 0) {
      const ownerId = parseInt(activeId, 10);
      // Store all OTHER accounts under the current user's key
      const others = accounts.filter(a => a.userId !== ownerId);
      if (others.length > 0) {
        saveStoredAccountsFor(ownerId, others);
      }
    }
    localStorage.removeItem(legacyKey);
  } catch {
    localStorage.removeItem(legacyKey);
  }
}

function upsertAccount(accounts: StoredAccount[], account: StoredAccount): StoredAccount[] {
  const idx = accounts.findIndex(a => a.userId === account.userId);
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  return [...accounts];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [activeRole, setActiveRole] = useState<string>(localStorage.getItem(ACTIVE_ROLE_KEY) || '');

  const refreshUser = async () => {
    try {
      const profile = await api.getProfile();
      setUser(profile);
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(profile.id));

      // Update the added account's token in the owner's stored list
      // (so switching back works with a fresh token)
      const token = localStorage.getItem('token');
      if (token && profile) {
        const accounts = getStoredAccountsFor(profile.id);
        // Update stored accounts list for display
        setStoredAccounts(accounts);
      }
    } catch (err) {
      localStorage.removeItem('token');
      setUser(null);
      throw err;
    }
  };

  useEffect(() => {
    migrateLegacyAccounts();
    const activeId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    if (activeId) {
      setStoredAccounts(getStoredAccountsFor(parseInt(activeId, 10)));
    }
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser().catch(() => {}).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (phone: string, password: string) => {
    const res = await api.login({ phone, password });
    localStorage.setItem('token', res.token);
    if (res.force_password_change) {
      localStorage.setItem('force_password_change', '1');
    } else {
      localStorage.removeItem('force_password_change');
    }
    await refreshUser();
    setIsAddingAccount(false);
  };

  const requestOTP = async (phone: string) => {
    const res = await api.requestOTP({ phone });
    return res;
  };

  const loginWithOTP = async (phone: string, otp: string) => {
    const res = await api.verifyOTP({ phone, otp });
    localStorage.setItem('token', res.token);
    await refreshUser();
    setIsAddingAccount(false);
  };

  const loginWithGoogle = async (idToken: string) => {
    const res = await api.googleAuth({ id_token: idToken });
    localStorage.setItem('token', res.token);
    await refreshUser();
    setIsAddingAccount(false);
  };

  const register = async (data: RegisterData) => {
    const res = await api.register(data);
    localStorage.setItem('token', res.token);
    await refreshUser();
    setIsAddingAccount(false);
  };

  const logout = () => {
    // Keep stored accounts intact so they persist on next login.
    // Just clear the active session.
    localStorage.removeItem('token');
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    setUser(null);
    setStoredAccounts([]);
  };

  const switchAccount = async (userId: number) => {
    if (!user) return;
    const ownerId = user.id;
    const accounts = getStoredAccountsFor(ownerId);
    const target = accounts.find(a => a.userId === userId);
    if (!target) return;

    const previousToken = localStorage.getItem('token');
    localStorage.setItem('token', target.token);
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(userId));
    setLoading(true);
    try {
      await refreshUser();
    } catch {
      // Token may be expired — remove the stale account and restore previous token
      const updated = accounts.filter(a => a.userId !== userId);
      saveStoredAccountsFor(ownerId, updated);
      setStoredAccounts(updated);
      if (previousToken) {
        localStorage.setItem('token', previousToken);
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(ownerId));
        await refreshUser().catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  const addAccount = async (phone: string, password: string) => {
    if (!user) return;
    const ownerId = user.id;
    // Login as the new account to get their token and profile
    const res = await api.login({ phone, password });
    const newToken = res.token;

    // Temporarily set the new token to fetch the new user's profile
    localStorage.setItem('token', newToken);
    let newProfile;
    try {
      newProfile = await api.getProfile();
    } catch {
      // Restore original token on failure
      const origToken = localStorage.getItem('token');
      if (!origToken) {
        localStorage.removeItem('token');
      }
      throw new Error('Failed to fetch added account profile');
    }

    // Store the new account under the OWNER's account list
    const accounts = getStoredAccountsFor(ownerId);
    const updated = upsertAccount(accounts, {
      token: newToken,
      userId: newProfile.id,
      name: `${newProfile.first_name} ${newProfile.last_name}`,
      phone: newProfile.phone,
      roles: newProfile.roles,
    });
    saveStoredAccountsFor(ownerId, updated);
    setStoredAccounts(updated);

    // Switch to the newly added account
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(newProfile.id));
    setUser(newProfile);
    setIsAddingAccount(false);
  };

  const removeAccount = (userId: number) => {
    if (!user) return;
    const ownerId = user.id;
    const accounts = getStoredAccountsFor(ownerId).filter(a => a.userId !== userId);
    saveStoredAccountsFor(ownerId, accounts);
    setStoredAccounts(accounts);
  };

  // Determine effective role: use activeRole if set and valid, otherwise highest role
  const effectiveRole = activeRole && user?.roles.includes(activeRole) ? activeRole : (user?.roles[0] || 'user');

  // Set activeRole on user load if not set
  useEffect(() => {
    if (user && (!activeRole || !user.roles.includes(activeRole))) {
      const defaultRole = user.roles[0] || 'user';
      setActiveRole(defaultRole);
      localStorage.setItem(ACTIVE_ROLE_KEY, defaultRole);
    }
  }, [user]);

  const switchRole = (role: string) => {
    if (user?.roles.includes(role)) {
      setActiveRole(role);
      localStorage.setItem(ACTIVE_ROLE_KEY, role);
    }
  };

  // Role checks based on active role
  const isAdmin = effectiveRole === 'admin';
  const isModerator = effectiveRole === 'moderator' || effectiveRole === 'admin';
  const isGroundManagement = effectiveRole === 'ground_management' || effectiveRole === 'admin';
  const isReadOnly = effectiveRole === 'readonly';

  return (
    <AuthContext.Provider value={{
      user, loading, login, loginWithOTP, requestOTP, loginWithGoogle,
      register, logout, refreshUser, isAdmin, isModerator, isGroundManagement, isReadOnly,
      activeRole: effectiveRole, switchRole,
      storedAccounts, switchAccount, addAccount, removeAccount,
      isAddingAccount, setIsAddingAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
