"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_THEME,
  STORAGE_KEY,
  STORAGE_KEY_DARK,
  isThemeId,
  type ThemeId,
} from "@/lib/themes";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  isDark: boolean;
  setDark: (next: boolean) => void;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {}
  return DEFAULT_THEME;
}

function readInitialDark(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [isDark, setIsDark] = useState<boolean>(readInitialDark);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const setDark = useCallback((next: boolean) => {
    setIsDark(next);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next);
    }
    try {
      localStorage.setItem(STORAGE_KEY_DARK, String(next));
    } catch {}
  }, []);

  const toggleDark = useCallback(() => {
    setDark(!isDark);
  }, [isDark, setDark]);

  useEffect(() => {
    const actual = document.documentElement.classList.contains("dark");
    if (actual !== isDark) {
      setIsDark(actual);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && isThemeId(e.newValue) && e.newValue !== theme) {
        setThemeState(e.newValue);
        document.documentElement.dataset.theme = e.newValue;
      }
      if (e.key === STORAGE_KEY_DARK && e.newValue !== null) {
        const nextDark = e.newValue === "true";
        if (nextDark !== isDark) {
          setIsDark(nextDark);
          document.documentElement.classList.toggle("dark", nextDark);
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme, isDark]);

  const value = useMemo(
    () => ({ theme, setTheme, isDark, setDark, toggleDark }),
    [theme, setTheme, isDark, setDark, toggleDark],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      isDark: true,
      setDark: () => {},
      toggleDark: () => {},
    };
  }
  return ctx;
}
