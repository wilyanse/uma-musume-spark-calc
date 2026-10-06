/** App shell: NavRail (desktop), BottomTabs (mobile), synthetic-data banner, theme. */
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHealth, useMaster, useReviewItems, qk } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { readJson, writeJson } from '../lib/storage.ts';

const NAV = [
  ['roster', 'Roster'],
  ['review', 'Review'],
  ['cards', 'Cards'],
  ['targets', 'Targets'],
  ['planner', 'Planner'],
  ['health', 'Health'],
] as const;

type Theme = 'system' | 'light' | 'dark';
const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

export function useTheme(): [Theme, (t: Theme) => void] {
  const { store } = useServices();
  const [theme, setTheme] = useState<Theme>(() => readJson(store, 'uma:theme', isTheme, 'system'));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    writeJson(store, 'uma:theme', theme);
  }, [theme, store]);
  return [theme, setTheme];
}

function ReviewBadge() {
  const q = useReviewItems('open');
  const n = q.data?.length ?? 0;
  if (!q.isSuccess || n === 0) return null;
  return (
    <span className="badge-count" aria-label={`${n} open review items`}>
      {n}
    </span>
  );
}

function ModelFooter() {
  const { source } = useServices();
  const q = useQuery({ queryKey: qk.snapshot('latest'), queryFn: () => source.latestSnapshot() });
  if (!q.isSuccess) return <>Model: —</>;
  if (!q.data) return <>Model: none yet</>;
  return <>Model: {q.data.kind === 'training-v1' ? 'training-v1 (legacy)' : q.data.kind}</>;
}

export function Layout() {
  const { source } = useServices();
  const health = useHealth();
  const master = useMaster();
  const [theme, setTheme] = useTheme();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const fixture = source.kind === 'fixture';
  const version = master.data?.version ?? health.data?.masterVersion ?? '…';
  const active = (k: string) =>
    loc.pathname.startsWith(`/${k}`) || (k === 'roster' && loc.pathname.startsWith('/veterans'));
  const moreActive = ['review', 'cards', 'health'].some(active);

  return (
    <div className={`app${fixture ? ' has-banner' : ''}`}>
      {fixture && (
        <div className="synthetic" role="note">
          <span aria-hidden="true">⚠</span>
          Fixture mode: SYNTHETIC golden dataset (T08), not a real account. Edits stay in this tab
          only.
        </div>
      )}
      <nav className="rail" aria-label="Main">
        <div className="brand">
          <i aria-hidden="true">★</i>Uma Spark Calc
        </div>
        {NAV.map(([key, label]) => (
          <NavLink
            key={key}
            className="nav"
            to={`/${key}`}
            aria-current={active(key) ? 'page' : undefined}
          >
            <span>{label}</span>
            {key === 'review' && <ReviewBadge />}
          </NavLink>
        ))}
        <div className="foot">
          Master data {version}
          <br />
          <ModelFooter />
          <label className="field theme-toggle">
            <span>Theme</span>
            <select
              className="input"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </nav>
      <div className="main">
        <Outlet />
        {more && (
          <nav className="mobile-more panel" aria-label="More">
            <div className="body grid">
              <NavLink to="/review">
                Review <ReviewBadge />
              </NavLink>
              <NavLink to="/cards">Cards</NavLink>
              <NavLink to="/health">Health</NavLink>
              <label className="field">
                <span>Theme</span>
                <select
                  className="input"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as Theme)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>
          </nav>
        )}
        <nav className="tabs-bottom" aria-label="Main (mobile)">
          <NavLink to="/roster" aria-current={active('roster') ? 'page' : undefined}>
            <span aria-hidden="true">☰</span>Roster
          </NavLink>
          <NavLink to="/planner" aria-current={active('planner') ? 'page' : undefined}>
            <span aria-hidden="true">⇅</span>Planner
          </NavLink>
          <NavLink to="/targets" aria-current={active('targets') ? 'page' : undefined}>
            <span aria-hidden="true">◎</span>Targets
          </NavLink>
          <button
            type="button"
            className="linklike-tab"
            aria-expanded={more}
            aria-current={moreActive ? 'page' : undefined}
            onClick={() => setMore((x) => !x)}
          >
            <span aria-hidden="true">⋯</span>More
            <ReviewBadge />
          </button>
        </nav>
      </div>
    </div>
  );
}

/** One screen: topbar (title + actions) and the scrolling content area. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} — Uma Spark Calc`;
  }, [title]);
  return (
    <>
      <header className="topbar">
        <h1>{title}</h1>
        <span className="sp" />
        {actions}
      </header>
      <main className="content" id="content">
        {children}
      </main>
    </>
  );
}
