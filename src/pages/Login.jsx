import { useState } from 'react';
import { useApp } from '../App.jsx';

export default function Login() {
  const { login, leagueName } = useApp();
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.username.trim(), form.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">
            CricVault
            <small>League operating system</small>
          </span>
        </div>
        <h1>
          Every ball.
          <em>On the record.</em>
        </h1>
        <p className="lede">
          Run your league end to end — squads, fixtures, ball-by-ball scoring, IPL-style points tables, playoffs and a
          permanent record book for every player who walks out to bat.
        </p>
        <div className="login-feats">
          <div>
            <div className="k">Ball by ball</div>
            <div className="d">Live scoring</div>
          </div>
          <div>
            <div className="k">Season archives</div>
            <div className="d">Independent history</div>
          </div>
          <div>
            <div className="k">Top 5</div>
            <div className="d">Playoff brackets</div>
          </div>
        </div>
      </section>

      <section className="login-form">
        <div className="eyebrow">{leagueName}</div>
        <h2 style={{ marginTop: 8 }}>Sign in</h2>
        <p className="sub">Administrators manage the league. Team accounts follow their own squad.</p>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            {error ? <div className="error-text">{error}</div> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter the vault'}
            </button>
          </div>
        </form>
        <div className="demo-box">
          <div>
            First run? Sign in with <b>admin</b> / <b>admin123</b> and change the password in Settings.
          </div>
          <div>Team logins are created from the Teams page by the administrator.</div>
        </div>
      </section>
    </div>
  );
}
