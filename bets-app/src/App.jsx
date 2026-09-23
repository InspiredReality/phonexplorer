import BetsPage from './BetsPage';
import AdminPage from './AdminPage';
import MyBetsPage from './MyBetsPage';

// No router dependency needed for these routes — just check the path directly.
// /cheify is intentionally not linked from anywhere in the UI.
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/cheify') return <AdminPage />;
  if (path === '/my-bets') return <MyBetsPage />;
  return <BetsPage />;
}
