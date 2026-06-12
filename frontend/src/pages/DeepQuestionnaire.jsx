import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './DeepQuestionnaire.css';

const STEPS = [
  {
    id: 'focus',
    question: 'What is your primary focus?',
    subtitle: 'Choose what matters most right now.',
    type: 'single',
    options: [
      { value: 'organization', label: 'Organization', icon: '⬡', desc: 'Structure and systems' },
      { value: 'exploration', label: 'Exploration', icon: '◎', desc: 'Discovery and curiosity' },
      { value: 'connection', label: 'Connection', icon: '◈', desc: 'Links and relationships' },
      { value: 'creation', label: 'Creation', icon: '◆', desc: 'Building something new' },
    ],
  },
  {
    id: 'thinking',
    question: 'How do you think best?',
    subtitle: 'Pick the style that feels most natural.',
    type: 'single',
    options: [
      { value: 'visual', label: 'Visually', icon: '▣', desc: 'Maps, diagrams, spatial' },
      { value: 'structural', label: 'Structurally', icon: '≡', desc: 'Lists, hierarchies, order' },
      { value: 'intuitive', label: 'Intuitively', icon: '◉', desc: 'Feel-first, then reflect' },
      { value: 'analytical', label: 'Analytically', icon: '⊞', desc: 'Data, logic, patterns' },
    ],
  },
  {
    id: 'challenge',
    question: "What's your biggest challenge?",
    subtitle: 'Be honest — this shapes your config.',
    type: 'single',
    options: [
      { value: 'overload', label: 'Too much input', icon: '≈', desc: 'Overwhelmed by information' },
      { value: 'clarity', label: 'Lack of clarity', icon: '◌', desc: "Hard to see what matters" },
      { value: 'system', label: 'No system', icon: '□', desc: 'Everything feels scattered' },
      { value: 'connections', label: 'Weak connections', icon: '⋯', desc: "Ideas don't link up" },
    ],
  },
  {
    id: 'depth',
    question: 'How deep do you want to go?',
    subtitle: 'And how much time can you commit daily?',
    type: 'single',
    options: [
      { value: 'surface', label: 'Surface', icon: '—', desc: '5 min · quick captures' },
      { value: 'medium', label: 'Medium', icon: '≈', desc: '15 min · daily review' },
      { value: 'deep', label: 'Deep', icon: '↓', desc: '30 min · full sessions' },
      { value: 'immersive', label: 'Immersive', icon: '⬇', desc: '1 hr+ · total focus' },
    ],
  },
];

const PROFILES = {
  organization: { label: 'The Architect', color: '#6366f1' },
  exploration:  { label: 'The Scout',     color: '#10b981' },
  connection:   { label: 'The Weaver',    color: '#f6287e' },
  creation:     { label: 'The Forge',     color: '#f59e0b' },
};

const DEPTH_CONFIG = {
  surface:   { sessions: '5 min bursts',   mode: 'Capture-first' },
  medium:    { sessions: '15 min reviews',  mode: 'Review & Link' },
  deep:      { sessions: '30 min sessions', mode: 'Deep Analysis' },
  immersive: { sessions: '1 hr+ blocks',    mode: 'Full Immersion' },
};

function buildConfig(answers) {
  const profile   = PROFILES[answers.focus]     || PROFILES.exploration;
  const depthConf = DEPTH_CONFIG[answers.depth] || DEPTH_CONFIG.medium;

  const suggestions = {
    organization: ['Start with OrgLevels', 'Build daily structure rituals', 'Tag everything on capture'],
    exploration:  ['Open PhoneExplorer daily', 'Follow curiosity chains freely', 'Collect before you curate'],
    connection:   ['Map links between realities', 'Surface hidden patterns weekly', 'Cross-reference across levels'],
    creation:     ['Reserve uninterrupted blocks', 'Ship small, iterate fast', 'Use capture to feed creation'],
  };

  return {
    profile,
    depthConf,
    suggestions: suggestions[answers.focus] || suggestions.exploration,
    thinking: answers.thinking,
    challenge: answers.challenge,
  };
}

export default function DeepQuestionnaire() {
  const navigate = useNavigate();
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState({});
  const [selected, setSelected] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [done, setDone]       = useState(false);

  const current = STEPS[step];
  const progress = ((step) / STEPS.length) * 100;

  function choose(value) {
    if (animating) return;
    setSelected(value);
  }

  function advance() {
    if (!selected || animating) return;
    const newAnswers = { ...answers, [current.id]: selected };
    setAnswers(newAnswers);
    setAnimating(true);

    setTimeout(() => {
      if (step + 1 >= STEPS.length) {
        setDone(true);
      } else {
        setStep(step + 1);
        setSelected(null);
      }
      setAnimating(false);
    }, 320);
  }

  function restart() {
    setStep(0);
    setAnswers({});
    setSelected(null);
    setDone(false);
  }

  if (done) {
    const config = buildConfig(answers);
    return (
      <div className="dq-container">
        <div className={`dq-card dq-card--result ${animating ? 'dq-exit' : 'dq-enter'}`}>
          <div className="dq-result-badge" style={{ borderColor: config.profile.color, color: config.profile.color }}>
            {config.profile.label}
          </div>

          <h1 className="dq-result-title">Your DEEP Profile</h1>
          <p className="dq-result-sub">Tailored to how you think and what you need.</p>

          <div className="dq-config-grid">
            <div className="dq-config-item">
              <span className="dq-config-label">Mode</span>
              <span className="dq-config-value" style={{ color: config.profile.color }}>
                {config.depthConf.mode}
              </span>
            </div>
            <div className="dq-config-item">
              <span className="dq-config-label">Sessions</span>
              <span className="dq-config-value">{config.depthConf.sessions}</span>
            </div>
            <div className="dq-config-item">
              <span className="dq-config-label">Thinking style</span>
              <span className="dq-config-value">{answers.thinking}</span>
            </div>
            <div className="dq-config-item">
              <span className="dq-config-label">Focus area</span>
              <span className="dq-config-value">{answers.challenge}</span>
            </div>
          </div>

          <div className="dq-suggestions">
            <span className="dq-suggestions-label">Recommendations</span>
            <ul className="dq-suggestions-list">
              {config.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="dq-result-actions">
            <button className="dq-btn dq-btn--primary" style={{ borderColor: config.profile.color, color: config.profile.color }}
              onClick={() => navigate('/')}>
              Enter
            </button>
            <button className="dq-btn dq-btn--ghost" onClick={restart}>
              Retake
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dq-container">
      <button className="dq-back" onClick={() => step === 0 ? navigate('/') : (setStep(step - 1), setSelected(answers[STEPS[step - 1].id] || null))}>
        ←
      </button>

      <div className="dq-progress-bar">
        <div className="dq-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className={`dq-card ${animating ? 'dq-exit' : 'dq-enter'}`} key={step}>
        <div className="dq-step-count">{step + 1} / {STEPS.length}</div>
        <h2 className="dq-question">{current.question}</h2>
        <p className="dq-subtitle">{current.subtitle}</p>

        <div className="dq-options">
          {current.options.map((opt) => (
            <button
              key={opt.value}
              className={`dq-option ${selected === opt.value ? 'dq-option--selected' : ''}`}
              onClick={() => choose(opt.value)}
            >
              <span className="dq-option-icon">{opt.icon}</span>
              <span className="dq-option-text">
                <span className="dq-option-label">{opt.label}</span>
                <span className="dq-option-desc">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <button
          className={`dq-next ${selected ? 'dq-next--active' : ''}`}
          onClick={advance}
          disabled={!selected}
        >
          {step + 1 === STEPS.length ? 'See my profile' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
