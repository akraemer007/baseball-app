import { Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import LeaguePage from './pages/LeaguePage';
import TeamPage from './pages/TeamPage';
import PlayersPage from './pages/PlayersPage';

export default function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <Routes>
        <Route path="/" element={<LeaguePage />} />
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
