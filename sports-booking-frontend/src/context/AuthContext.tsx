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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const profile = await api.getProfile();
      setUser(profile);
    } catch {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (phone: string, password: string) => {
    const res = await api.login({ phone, password });
    localStorage.setItem('token', res.token);
    await refreshUser();
  };

  const requestOTP = async (phone: string) => {
    const res = await api.requestOTP({ phone });
    return res;
  };

  const loginWithOTP = async (phone: string, otp: string) => {
    const res = await api.verifyOTP({ phone, otp });
    localStorage.setItem('token', res.token);
    await refreshUser();
  };

  const loginWithGoogle = async (googleId: string, email: string, firstName: string, lastName: string) => {
    const res = await api.googleAuth({ google_id: googleId, email, first_name: firstName, last_name: lastName });
    localStorage.setItem('token', res.token);
    await refreshUser();
  };

  const register = async (data: RegisterData) => {
    const res = await api.register(data);
    localStorage.setItem('token', res.token);
    await refreshUser();
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const isAdmin = user?.roles.includes('admin') || false;
  const isModerator = user?.roles.includes('moderator') || false;

  return (
    <AuthContext.Provider value={{
      user, loading, login, loginWithOTP, requestOTP, loginWithGoogle,
      register, logout, refreshUser, isAdmin, isModerator
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
