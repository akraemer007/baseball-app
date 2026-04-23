import { NavLink } from 'react-router-dom';

export default function NavBar() {
  return (
    <nav className="navbar">
      <span className="navbar-brand">ak_baseball</span>
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
        League
      </NavLink>
      <NavLink to="/team/CHC" className={({ isActive }) => (isActive ? 'active' : '')}>
        Team
      </NavLink>
      <NavLink to="/news" className={({ isActive }) => (isActive ? 'active' : '')}>
        News
      </NavLink>
    </nav>
  );
}
