/**
 * Preferences: which two teams the viewer cares about + a per-page
 * comparison slot. Persisted in localStorage, exposed via a React Context
 * so the NavBar, League page, News page, and Team page all read from the
 * same source.
 *
 * primaryTeam    — the team whose games get pinned first, whose division
 *                  anchors the League-page featured chart, whose page opens
 *                  by default when you click the Team tab, and whose
 *                  division-mates get a pill on news recaps.
 * secondaryTeam  — a second team whose games also get a pinned slot
 *                  (behind the primary) and a subtler pill, but no
 *                  division tagging.
 * comparisonTeam — the team currently selected via the Team-page "Compare
 *                  to…" dropdown. Persists across reloads so a comparison
 *                  doesn't evaporate on F5, but it's a per-page transient
 *                  in spirit (cleared by picking "(none)").
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
  primaryTeam: string;            // abbrev e.g. 'CHC'
  secondaryTeam: string;          // abbrev e.g. 'TEX'
  comparisonTeam: string | null;  // abbrev e.g. 'NYY' or null when none
}

const DEFAULTS: PreferencesState = {
  primaryTeam: 'CHC',
  secondaryTeam: 'TEX',
  comparisonTeam: null,
};

interface PreferencesContextValue extends PreferencesState {
  setPrimaryTeam: (abbrev: string) => void;
  setSecondaryTeam: (abbrev: string) => void;
  setComparisonTeam: (abbrev: string | null) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStored(): PreferencesState {
  // comparisonTeam is intentionally NOT persisted — it's a transient
  // per-visit selection (the user picks "compare to TEX" while looking at
  // CHC, but next time they open the page they probably want a fresh
  // unfiltered view). Always start at null on mount.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PreferencesState>;
    return {
      primaryTeam: parsed.primaryTeam || DEFAULTS.primaryTeam,
      secondaryTeam: parsed.secondaryTeam || DEFAULTS.secondaryTeam,
      comparisonTeam: null,
    };
  } catch {
    return DEFAULTS;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreferencesState>(() => readStored());

  // Persist primaryTeam + secondaryTeam only. comparisonTeam stays in
  // memory as a transient selection.
  useEffect(() => {
    try {
      const persisted = {
        primaryTeam: state.primaryTeam,
        secondaryTeam: state.secondaryTeam,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      /* quota or disabled — no-op */
    }
  }, [state.primaryTeam, state.secondaryTeam]);

  const setPrimaryTeam = useCallback(
    (abbrev: string) => setState((s) => ({ ...s, primaryTeam: abbrev.toUpperCase() })),
    [],
  );
  const setSecondaryTeam = useCallback(
    (abbrev: string) => setState((s) => ({ ...s, secondaryTeam: abbrev.toUpperCase() })),
    [],
  );
  const setComparisonTeam = useCallback(
    (abbrev: string | null) =>
      setState((s) => ({
        ...s,
        comparisonTeam: abbrev ? abbrev.toUpperCase() : null,
      })),
    [],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ ...state, setPrimaryTeam, setSecondaryTeam, setComparisonTeam }),
    [state, setPrimaryTeam, setSecondaryTeam, setComparisonTeam],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
