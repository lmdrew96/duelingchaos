import { useEffect, useState } from 'react';

// 'system' never lands in the DOM — resolveTheme collapses it to 'light' or
// 'dark' before it's written to <html data-theme>, which is all index.css's
// [data-theme="light"] override block needs to key off.
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'duelingchaos-theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

function readStoredTheme(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    if (theme !== 'system') return;
    // Only matters while the preference is 'system' — a live OS-level
    // light/dark flip should re-resolve without the user touching anything.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      document.documentElement.dataset.theme = resolveTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return [theme, setTheme];
}
