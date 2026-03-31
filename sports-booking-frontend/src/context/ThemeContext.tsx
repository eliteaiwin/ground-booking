import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { api } from '../services/api';

interface RoleTheme {
  primary_color: string;
  header_bg: string;
  button_bg: string;
  button_hover: string;
  accent_color: string;
}

type RoleThemes = Record<string, RoleTheme>;

interface ThemeContextType {
  themes: RoleThemes;
  activeTheme: RoleTheme;
  refreshThemes: () => Promise<void>;
}

const DEFAULT_THEMES: RoleThemes = {
  admin: { primary_color: '#7f1d1d', header_bg: '#7f1d1d', button_bg: '#7f1d1d', button_hover: '#991b1b', accent_color: '#7f1d1d' },
  moderator: { primary_color: '#1d4ed8', header_bg: '#1d4ed8', button_bg: '#1d4ed8', button_hover: '#1e40af', accent_color: '#1d4ed8' },
  ground_management: { primary_color: '#6b7280', header_bg: '#6b7280', button_bg: '#6b7280', button_hover: '#4b5563', accent_color: '#6b7280' },
  user: { primary_color: '#16a34a', header_bg: '#16a34a', button_bg: '#16a34a', button_hover: '#15803d', accent_color: '#16a34a' },
  readonly: { primary_color: '#16a34a', header_bg: '#16a34a', button_bg: '#16a34a', button_hover: '#15803d', accent_color: '#16a34a' },
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children, activeRole }: { children: ReactNode; activeRole: string }) {
  const [themes, setThemes] = useState<RoleThemes>(DEFAULT_THEMES);

  const loadThemes = async () => {
    try {
      const data = await api.getRoleThemes();
      setThemes({ ...DEFAULT_THEMES, ...data });
    } catch {
      // Use defaults on failure
    }
  };

  useEffect(() => {
    loadThemes();
  }, []);

  const activeTheme = useMemo(() => {
    return themes[activeRole] || themes.user || DEFAULT_THEMES.user;
  }, [themes, activeRole]);

  // Apply CSS custom properties whenever activeTheme changes
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-primary', activeTheme.primary_color);
    root.style.setProperty('--theme-header-bg', activeTheme.header_bg);
    root.style.setProperty('--theme-button-bg', activeTheme.button_bg);
    root.style.setProperty('--theme-button-hover', activeTheme.button_hover);
    root.style.setProperty('--theme-accent', activeTheme.accent_color);
  }, [activeTheme]);

  return (
    <ThemeContext.Provider value={{ themes, activeTheme, refreshThemes: loadThemes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
