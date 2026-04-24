import { NavLink } from 'react-router-dom';
import { usePreferences } from '../lib/preferences';

export default function NavBar() {
  const { primaryTeam } = usePreferences();
  return (
    <nav className="navbar">
      <span className="navbar-brand">ak_baseball</span>
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
        League
      </NavLink>
      <NavLink to={`/team/${primaryTeam}`} className={({ isActive }) => (isActive ? 'active' : '')}>
        Team
      </NavLink>
      <NavLink to="/players" className={({ isActive }) => (isActive ? 'active' : '')}>
        Players
      </NavLink>
    </nav>
  );
}
