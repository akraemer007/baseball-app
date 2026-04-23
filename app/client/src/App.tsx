import { Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import LeaguePage from './pages/LeaguePage';
import TeamPage from './pages/TeamPage';
import PlayerPage from './pages/PlayerPage';
import NewsPage from './pages/NewsPage';

export default function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <Routes>
        <Route path="/" element={<LeaguePage />} />
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/player/:playerId" element={<PlayerPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
