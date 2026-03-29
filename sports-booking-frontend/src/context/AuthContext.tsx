import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

interface User {
  id: number;
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
  loginWithGoogle: (googleId: string, email: string, firstName: string, lastName: string) => Promise<void>;
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

const ACCOUNTS_KEY = 'stored_accounts';
const ACTIVE_ACCOUNT_KEY = 'active_account_id';
const ACTIVE_ROLE_KEY = 'active_role';

function getStoredAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredAccounts(accounts: StoredAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
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

      // Update stored account info for current user
      const token = localStorage.getItem('token');
      if (token && profile) {
        const updated = upsertAccount(getStoredAccounts(), {
          token,
          userId: profile.id,
          name: `${profile.first_name} ${profile.last_name}`,
          phone: profile.phone,
          roles: profile.roles,
        });
        saveStoredAccounts(updated);
        setStoredAccounts(updated);
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(profile.id));
      }
    } catch (err) {
      localStorage.removeItem('token');
      setUser(null);
      throw err;
    }
  };

  useEffect(() => {
    setStoredAccounts(getStoredAccounts());
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

  const loginWithGoogle = async (googleId: string, email: string, firstName: string, lastName: string) => {
    const res = await api.googleAuth({ google_id: googleId, email, first_name: firstName, last_name: lastName });
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
    // Remove current account from stored accounts
    const currentId = user?.id;
    if (currentId) {
      const accounts = getStoredAccounts().filter(a => a.userId !== currentId);
      saveStoredAccounts(accounts);
      setStoredAccounts(accounts);

      // If there are other accounts, switch to the first one
      if (accounts.length > 0) {
        localStorage.setItem('token', accounts[0].token);
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(accounts[0].userId));
        refreshUser().catch(() => {});
        return;
      }
    }
    localStorage.removeItem('token');
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    setUser(null);
  };

  const switchAccount = async (userId: number) => {
    const accounts = getStoredAccounts();
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
      saveStoredAccounts(updated);
      setStoredAccounts(updated);
      if (previousToken) {
        localStorage.setItem('token', previousToken);
        await refreshUser().catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  const addAccount = async (phone: string, password: string) => {
    const res = await api.login({ phone, password });
    localStorage.setItem('token', res.token);
    await refreshUser();
    setIsAddingAccount(false);
  };

  const removeAccount = (userId: number) => {
    const accounts = getStoredAccounts().filter(a => a.userId !== userId);
    saveStoredAccounts(accounts);
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
