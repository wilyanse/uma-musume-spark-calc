import { NavLink, Outlet } from 'react-router';

const links = ['roster', 'review', 'cards', 'targets', 'planner', 'health'];

export function Layout() {
  return (
    <>
      <nav aria-label="Main">
        {links.map((l) => (
          <NavLink key={l} to={`/${l}`} style={{ marginRight: 12 }}>
            {l}
          </NavLink>
        ))}
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}
