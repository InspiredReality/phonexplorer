import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PhoneExplorer from './pages/PhoneExplorer';
import AssignExplorer from './pages/AssignExplorer';
import MondayPage from './pages/MondayPage';
import DeepQuestionnaire from './pages/DeepQuestionnaire';
import StickersPage from './pages/StickersPage';

import Realities from './pages/Realities'
import OrgLevels  from './pages/OrgLevels'
import NeedlePage from './pages/NeedlePage'
import ConfigTest from './pages/ConfigTest'

// Assign/Needle now size to their parent (100%) so they can be embedded
// (e.g. inside the Config Test accordions) — give them a full-viewport
// parent here so the standalone routes still fill the screen as before.
const fullViewport = { height: '100vh', width: '100vw' };

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<PhoneExplorer />} />
        <Route path="/assign" element={<div style={fullViewport}><AssignExplorer /></div>} />
        <Route path="/monday" element={<MondayPage />} />
        <Route path="/deep" element={<DeepQuestionnaire />} />
        <Route path="/stickers" element={<StickersPage />} />

        <Route path="/realities"    element={<Realities />} />
        <Route path="/realities/:id" element={<OrgLevels />} />
        <Route path="/needle" element={<div style={fullViewport}><NeedlePage /></div>} />
        <Route path="/config-test" element={<ConfigTest />} />
      </Routes>
    </Router>
  );
}

export default App;
