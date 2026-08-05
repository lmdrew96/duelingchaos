import type { ThemePreference } from './theme';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
];

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={theme === value ? 'active' : 'ghost'}
          onClick={() => onChange(value)}
          title={label}
          aria-pressed={theme === value}
        >
          {value === 'light' && <SunIcon />}
          {value === 'dark' && <MoonIcon />}
          {value === 'system' && <SystemIcon />}
        </button>
      ))}
    </div>
  );
}
