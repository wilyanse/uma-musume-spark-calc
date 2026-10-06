import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { RosterScreen } from './screens/Roster.tsx';
import { VeteranScreen } from './screens/Veteran.tsx';
import { ReviewScreen } from './screens/Review.tsx';
import { CardsScreen } from './screens/Cards.tsx';
import { TargetsScreen } from './screens/Targets.tsx';
import { PlannerScreen } from './screens/Planner.tsx';
import { HealthScreen } from './screens/Health.tsx';

// Routes from docs/specs/60-web.md §2.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/roster" replace /> },
      { path: 'roster', element: <RosterScreen /> },
      { path: 'veterans/:id', element: <VeteranScreen /> },
      { path: 'review', element: <ReviewScreen /> },
      { path: 'cards', element: <CardsScreen /> },
      { path: 'targets', element: <TargetsScreen /> },
      { path: 'targets/:id', element: <TargetsScreen /> },
      { path: 'planner', element: <PlannerScreen /> },
      { path: 'health', element: <HealthScreen /> },
      { path: '*', element: <Navigate to="/roster" replace /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
