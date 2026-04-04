import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PhoneExplorer from './pages/PhoneExplorer';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<PhoneExplorer />} />
      </Routes>
    </Router>
  );
}

export default App;
