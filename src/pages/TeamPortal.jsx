import { Navigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import TeamPage from './TeamPage.jsx';

export default function TeamPortal() {
  const { user } = useApp();
  if (user.role === 'admin') return <Navigate to="/teams" replace />;
  return <TeamPage teamIdOverride={user.team_id} portal />;
}
