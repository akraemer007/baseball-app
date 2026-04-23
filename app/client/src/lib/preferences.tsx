/**
 * Preferences: which two teams the viewer cares about. Persisted in
 * localStorage, exposed via a React Context so the NavBar, League page,
 * News page, and Team page all read from the same source.
 *
 * primaryTeam   — the team whose games get pinned first, whose division
 *                 anchors the League-page featured chart, whose page opens
 *                 by default when you click the Team tab, and whose
 *                 division-mates get a pill on news recaps.
 * secondaryTeam — a second team whose games also get a pinned slot
 *                 (behind the primary) and a subtler pill, but no
 *                 division tagging.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'ak_baseball.prefs.v1';

interface PreferencesState {
  primaryTeam: string;   // abbrev e.g. 'CHC'
  secondaryTeam: string; // abbrev e.g. 'TEX'
}

const DEFAULTS: PreferencesState = {
  primaryTeam: 'CHC',
  secondaryTeam: 'TEX',
};

interface PreferencesContextValue extends PreferencesState {
  setPrimaryTeam: (abbrev: string) => void;
  setSecondaryTeam: (abbrev: string) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStored(): PreferencesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PreferencesState>;
    return {
      primaryTeam: parsed.primaryTeam || DEFAULTS.primaryTeam,
      secondaryTeam: parsed.secondaryTeam || DEFAULTS.secondaryTeam,
    };
  } catch {
    return DEFAULTS;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreferencesState>(() => readStored());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or disabled — no-op */
    }
  }, [state]);

  const setPrimaryTeam = useCallback(
    (abbrev: string) => setState((s) => ({ ...s, primaryTeam: abbrev.toUpperCase() })),
    [],
  );
  const setSecondaryTeam = useCallback(
    (abbrev: string) => setState((s) => ({ ...s, secondaryTeam: abbrev.toUpperCase() })),
    [],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ ...state, setPrimaryTeam, setSecondaryTeam }),
    [state, setPrimaryTeam, setSecondaryTeam],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
