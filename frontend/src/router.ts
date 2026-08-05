import { useEffect, useState } from 'react';

// Minimal History API router — three routes don't justify a routing
// library. Tracks window.location.pathname, patches it via pushState (a
// new back-stack entry) or replaceState (address-bar sync with no new
// entry, e.g. reflecting a save/load that doesn't feel like "navigating"),
// and re-renders on popstate (back/forward).
export function useRoute(): { path: string; navigate: (to: string, opts?: { replace?: boolean }) => void } {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (to: string, opts?: { replace?: boolean }) => {
    if (to === window.location.pathname) return;
    if (opts?.replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPath(to);
  };

  return { path, navigate };
}
