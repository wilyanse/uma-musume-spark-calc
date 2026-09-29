import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './routes/Layout.tsx';
import { Placeholder } from './routes/Placeholder.tsx';

// Routes from docs/specs/60-web.md §2. Screens are built by T13; these are placeholders.
export const routes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/roster" replace /> },
      { path: 'roster', element: <Placeholder title="Roster" /> },
      { path: 'veterans/:id', element: <Placeholder title="Veteran" /> },
      { path: 'review', element: <Placeholder title="Review" /> },
      { path: 'cards', element: <Placeholder title="Cards" /> },
      { path: 'targets', element: <Placeholder title="Targets" /> },
      { path: 'targets/:id', element: <Placeholder title="Target" /> },
      { path: 'planner', element: <Placeholder title="Planner" /> },
      { path: 'health', element: <Placeholder title="Health" /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
