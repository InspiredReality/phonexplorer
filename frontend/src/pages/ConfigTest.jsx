import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import NeedlePage from './NeedlePage';
import AssignExplorer from './AssignExplorer';
import './ConfigTest.css';

// Each module renders inside its own accordion, mounted only while expanded
// so two Three.js/Needle-Engine scenes aren't both running when collapsed.
const MODULES = [
  { id: 'needle', label: 'Needle', Component: NeedlePage },
  { id: 'assign', label: 'Assign', Component: AssignExplorer },
];

function ConfigTest() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({ needle: false, assign: false });

  const handleChange = (id) => (_event, isExpanded) => {
    setExpanded((prev) => ({ ...prev, [id]: isExpanded }));
  };

  return (
    <div className="config-test-page">
      <button className="config-test-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="config-test-heading">Config Test</h1>

      <div className="config-test-accordions">
        {MODULES.map(({ id, label, Component }) => (
          <Accordion
            key={id}
            expanded={!!expanded[id]}
            onChange={handleChange(id)}
            disableGutters
            sx={{
              bgcolor: '#111122',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<span className="config-test-expand-icon">▾</span>}
              sx={{
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.06)' },
                '.MuiAccordionSummary-content': { margin: '12px 0' },
              }}
            >
              <span className="config-test-summary-label">{label}</span>
            </AccordionSummary>
            <AccordionDetails sx={{ height: '40vh', p: 0, overflow: 'hidden', position: 'relative' }}>
              {expanded[id] && (
                <div className="config-test-module-frame">
                  <Component />
                </div>
              )}
            </AccordionDetails>
          </Accordion>
        ))}
      </div>
    </div>
  );
}

export default ConfigTest;
