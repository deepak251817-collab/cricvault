import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';

export default function Settings() {
  const { leagueName, refresh, user } = useApp();
  const toast = useToast();
  const [name, setName] = useState(leagueName);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [error, setError] = useState('');

  const saveName = async (e) => {
    e.preventDefault();
    setSavingName(true);
    try {
      await api('/settings', { method: 'PATCH', body: { leagueName: name } });
      await refresh();
      toast('League name updated');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.newPassword !== pw.confirm) {
      setError('The new passwords do not match');
      return;
    }
    setSavingPw(true);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
      });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">League configuration</div>
          <h1>Settings</h1>
          <div className="sub">Branding, your account, and the rules the scorebook follows.</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <div className="panel-head">
            <h3>League name</h3>
          </div>
          <form onSubmit={saveName} className="panel-body stack" style={{ gap: 12 }}>
            <div className="field">
              <label>Displayed across the app</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={savingName || name === leagueName}>
                {savingName ? 'Saving…' : 'Save league name'}
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Your account</h3>
            <span className="right badge role">{user.username}</span>
          </div>
          <form onSubmit={savePassword} className="panel-body stack" style={{ gap: 12 }}>
            <div className="field">
              <label>Current password</label>
              <input
                className="input"
                type="password"
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>New password</label>
                <input
                  className="input"
                  type="password"
                  value={pw.newPassword}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  className="input"
                  type="password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
            </div>
            {error ? <div className="error-text">{error}</div> : null}
            <div>
              <button type="submit" className="btn btn-primary" disabled={savingPw}>
                {savingPw ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Team logins</h3>
          </div>
          <div className="panel-body stack" style={{ gap: 10 }}>
            <p className="small muted">
              Every team can have one read-only account for their own analytics: squad contribution, player totals and
              season results. Create or reset those credentials from the Teams page.
            </p>
            <div>
              <Link className="btn" to="/teams">
                Manage team logins
              </Link>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>How the scorebook works</h3>
          </div>
          <div className="panel-body">
            <table className="sheet compact">
              <tbody>
                <tr>
                  <td className="strong">Squad</td>
                  <td>12 players per team per season</td>
                </tr>
                <tr>
                  <td className="strong">Playing XI</td>
                  <td>11 players, exactly one wicketkeeper</td>
                </tr>
                <tr>
                  <td className="strong">League points</td>
                  <td>Win 2 · Tie / No result 1 · Loss 0</td>
                </tr>
                <tr>
                  <td className="strong">NRR</td>
                  <td>Runs per over scored minus conceded; an all-out side counts its full overs</td>
                </tr>
                <tr>
                  <td className="strong">Formats</td>
                  <td>T20 (20 ov), ODI (50 ov), Test (4 innings), Custom (any overs, 2 or 4 innings)</td>
                </tr>
                <tr>
                  <td className="strong">Declarations</td>
                  <td>Available in Test and Custom formats</td>
                </tr>
                <tr>
                  <td className="strong">Playoffs</td>
                  <td>Top 2, top 4 (IPL style) or top 5 brackets</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
