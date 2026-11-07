import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { initials } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Seasons from './pages/Seasons.jsx';
import SeasonDetail from './pages/SeasonDetail.jsx';
import Matches from './pages/Matches.jsx';
import Scoring from './pages/Scoring.jsx';
import Scorecard from './pages/Scorecard.jsx';
import Teams from './pages/Teams.jsx';
import TeamPage from './pages/TeamPage.jsx';
import Players from './pages/Players.jsx';
import PlayerPage from './pages/PlayerPage.jsx';
import Records from './pages/Records.jsx';
import Settings from './pages/Settings.jsx';
import TeamPortal from './pages/TeamPortal.jsx';

const AppContext = createContext(null);
const ToastContext = createContext(() => {});

export const useApp = () => useContext(AppContext);
export const useToast = () => useContext(ToastContext);

const EMPTY = {
  loading: true,
  user: null,
  leagueName: 'The Cricket League',
  seasons: [],
  teams: [],
};

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--turf)' }}>
      <div style={{ textAlign: 'center', color: 'var(--cream)' }}>
        <div
          className="display"
          style={{ fontSize: 42, letterSpacing: '0.24em', fontWeight: 700, color: 'var(--amber)' }}
        >
          CRICVAULT
        </div>
        <div className="tiny" style={{ letterSpacing: '0.3em', marginTop: 6, opacity: 0.5 }}>
          LOADING THE GROUND
        </div>
      </div>
    </div>
  );
}

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', idx: '01', end: true },
  { to: '/seasons', label: 'Seasons', idx: '02' },
  { to: '/matches', label: 'Matches', idx: '03' },
  { to: '/teams', label: 'Teams', idx: '04' },
  { to: '/players', label: 'Players', idx: '05' },
  { to: '/records', label: 'Records', idx: '06' },
  { to: '/settings', label: 'Settings', idx: '07' },
];

const TEAM_NAV = [
  { to: '/team', label: 'My Team', idx: '01' },
  { to: '/seasons', label: 'Seasons', idx: '02' },
  { to: '/matches', label: 'Matches', idx: '03' },
  { to: '/records', label: 'Records', idx: '04' },
];

function RequireAdmin({ children }) {
  const { user } = useApp();
  if (user?.role !== 'admin') return <Navigate to="/team" replace />;
  return children;
}

function Shell() {
  const app = useApp();
  const nav = app.user.role === 'admin' ? ADMIN_NAV : TEAM_NAV;
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">
            CricVault
            <small>League OS</small>
          </span>
        </div>
        <div className="rail-section">Workspace</div>
        <nav className="nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="idx">{item.idx}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar">{initials(app.user.display_name || app.user.team_name || app.user.username)}</span>
            <span className="who">
              <b>{app.user.display_name || app.user.team_name || app.user.username}</b>
              <span>{app.user.role === 'admin' ? 'Administrator' : 'Team access'}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              title="Sign out"
              onClick={() => app.logout()}
              style={{ marginLeft: 'auto', borderColor: 'rgba(243,237,220,.2)', color: 'rgba(243,237,220,.7)' }}
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="league">{app.leagueName}</span>
          <div className="topbar-right">
            <span className="tiny muted" style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {new Date().toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}
            </span>
            <span className="top-user">
              <span className="avatar">{initials(app.user.display_name || app.user.username)}</span>
              <span>
                <b>{app.user.username}</b>
              </span>
            </span>
          </div>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={app.user.role === 'team' ? <TeamPortal /> : <Dashboard />} />
            <Route path="/team" element={<TeamPortal />} />
            <Route path="/seasons" element={<Seasons />} />
            <Route path="/seasons/:id" element={<SeasonDetail />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/matches/:id" element={<Scoring />} />
            <Route path="/matches/:id/scorecard" element={<Scorecard />} />
            <Route path="/teams" element={<RequireAdmin><Teams /></RequireAdmin>} />
            <Route path="/teams/:id" element={<TeamPage />} />
            <Route path="/players" element={<RequireAdmin><Players /></RequireAdmin>} />
            <Route path="/players/:id" element={<PlayerPage />} />
            <Route path="/records" element={<Records />} />
            <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(EMPTY);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'ok') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list, { id, message: String(message), type }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/bootstrap');
      setState({ ...EMPTY, ...data, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, loading: false }));
      toast(err.message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (username, password) => {
      await api('/auth/login', { method: 'POST', body: { username, password } });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = { ...state, refresh, login, logout };

  if (state.loading) return <Splash />;

  return (
    <AppContext.Provider value={value}>
      <ToastContext.Provider value={toast}>
        {state.user ? <Shell /> : <Login />}
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : ''}`}>
              {t.message}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </AppContext.Provider>
  );
}
