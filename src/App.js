import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PhoneExplorer from './pages/PhoneExplorer';
import MondayPage from './pages/MondayPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<PhoneExplorer />} />
        <Route path="/monday" element={<MondayPage />} />
      </Routes>
    </Router>
  );
}

export default App;
