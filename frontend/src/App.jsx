import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PhoneExplorer from './pages/PhoneExplorer';
import MondayPage from './pages/MondayPage';
import DeepQuestionnaire from './pages/DeepQuestionnaire';

import Realities from './pages/Realities'
import OrgLevels  from './pages/OrgLevels'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<PhoneExplorer />} />
        <Route path="/monday" element={<MondayPage />} />
        <Route path="/deep" element={<DeepQuestionnaire />} />

        <Route path="/realities"    element={<Realities />} />
        <Route path="/realities/:id" element={<OrgLevels />} />
      </Routes>
    </Router>
  );
}

export default App;
