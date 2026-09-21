import BetsPage from './BetsPage';
import AdminPage from './AdminPage';

// No router dependency needed for two routes — just check the path directly.
// /cheify is intentionally not linked from anywhere in the UI.
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '/cheify' ? <AdminPage /> : <BetsPage />;
}
