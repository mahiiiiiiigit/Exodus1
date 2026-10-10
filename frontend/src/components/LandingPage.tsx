import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, CirclePlay, Clock3, Layers3, Menu, Moon, MoveUpRight, Shield, ShieldCheck, Sun, Users, Wind, X } from 'lucide-react'

const benefits = [
  { icon: Layers3, title: 'Know the way out', text: 'Turn floor plans into clear, accessible evacuation routes in minutes.' },
  { icon: Wind, title: 'See what could happen', text: 'Model smoke, fire, and changing conditions across every floor.' },
  { icon: Users, title: 'Plan for every person', text: 'Understand how real people move, gather, and need support.' },
]

function Brand() {
  return <a className="brand" href="#top" aria-label="Exodus home"><span className="brand-symbol"><i/><i/><i/></span><span>exodus</span></a>
}

function FloorPlanPreview() {
  return (
    <div className="preview-wrap" aria-label="Preview of a building evacuation simulation">
      <div className="preview-glow"/>
      <div className="plan-card">
        <div className="plan-toolbar"><div className="plan-title"><span className="plan-icon"><Layers3 size={15}/></span><span><strong>North Tower</strong><small>Floor 04 <b>·</b> Office floor</small></span></div><button className="live-pill"><i/> LIVE SIMULATION</button></div>
        <div className="plan-canvas">
          <div className="plan-grid"/><div className="plan-north">N <span>↑</span></div>
          <svg className="plan-drawing" viewBox="0 0 660 380" role="img" aria-label="Floor plan showing an incident and two evacuation routes">
            <defs><pattern id="plan-paper-grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="currentColor" strokeWidth=".5" opacity=".23"/></pattern><marker id="evac-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0 0L0 6L6 3Z" fill="#37b78a"/></marker><filter id="hazard-glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
            <g transform="translate(66 30)"><rect x="0" y="0" width="530" height="286" rx="4" className="plan-outline"/><rect x="10" y="10" width="510" height="266" fill="url(#plan-paper-grid)" className="plan-fill"/><rect x="14" y="120" width="502" height="44" className="plan-corridor"/>
              <path d="M120 12V120M235 12V120M355 12V120M438 12V120M120 164V274M235 164V274M355 164V274M438 164V274M14 68H120M120 68H235M235 68H355M355 68H438M438 68H516M14 222H120M120 222H235M235 222H355M355 222H438M438 222H516" className="plan-walls"/>
              <rect x="18" y="128" width="56" height="28" rx="2" className="plan-core"/><rect x="458" y="128" width="50" height="28" rx="2" className="plan-core"/><rect x="276" y="128" width="50" height="28" rx="2" className="plan-core"/><path d="M28 151l9-18 9 18 9-18 9 18M466 151l9-18 9 18 9-18 9 18" className="stair-lines"/>
              <text x="47" y="147" textAnchor="middle" className="plan-label">STAIR A</text><text x="483" y="147" textAnchor="middle" className="plan-label">STAIR B</text><text x="301" y="147" textAnchor="middle" className="plan-label">LIFT</text>
              <text x="66" y="43" textAnchor="middle" className="plan-label">OPEN OFFICE</text><text x="178" y="43" textAnchor="middle" className="plan-label">MEETING</text><text x="293" y="43" textAnchor="middle" className="plan-label">OPEN OFFICE</text><text x="396" y="43" textAnchor="middle" className="plan-label">BREAKOUT</text><text x="475" y="43" textAnchor="middle" className="plan-label">OFFICE</text><text x="66" y="197" textAnchor="middle" className="plan-label">OPEN OFFICE</text><text x="178" y="197" textAnchor="middle" className="plan-label">MEETING</text><text x="293" y="197" textAnchor="middle" className="plan-label">OPEN OFFICE</text><text x="396" y="197" textAnchor="middle" className="plan-label">FOCUS ROOM</text><text x="475" y="197" textAnchor="middle" className="plan-label">OFFICE</text>
              <g className="plan-exit"><rect x="36" y="280" width="22" height="7" rx="2"/><path d="M39 281v-13h16v13"/><text x="47" y="302" textAnchor="middle">EXIT</text></g><g className="plan-exit"><rect x="466" y="280" width="22" height="7" rx="2"/><path d="M469 281v-13h16v13"/><text x="477" y="302" textAnchor="middle">EXIT</text></g>
              <g className="plan-hazard" transform="translate(398 142)" filter="url(#hazard-glow)"><circle r="23"/><circle r="7"/><path d="M-1-11l-5 10h5l-1 10 8-13H2l3-7z"/></g><path d="M398 142C395 188 455 226 477 272" className="plan-route route-a" markerEnd="url(#evac-arrow)"/><path d="M398 142C330 203 204 230 47 272" className="plan-route route-b" markerEnd="url(#evac-arrow)"/>
              <g className="person-dot" transform="translate(102 91)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot" transform="translate(181 97)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot moving-dot" transform="translate(298 89)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot" transform="translate(332 224)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot moving-dot" transform="translate(215 202)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot" transform="translate(125 244)"><circle r="5"/><circle r="1.7"/></g><g className="person-dot" transform="translate(476 205)"><circle r="5"/><circle r="1.7"/></g>
            </g>
          </svg>
          <div className="map-chip"><span className="hazard-chip-dot"/><span><strong>Fire detected</strong><small>East breakout room · Floor 04</small></span><ArrowUpRight size={14}/></div>
          <div className="map-key"><span><i className="key-exit"/>Exit</span><span><i className="key-route"/>Safe route</span><span><i className="key-people"/>Occupants</span></div>
        </div>
        <div className="plan-footer"><span><span className="footer-check"><Check size={11}/></span>AI routes updated for current conditions</span><span className="map-time"><Clock3 size={12}/> 4 min 32 sec</span></div>
      </div>
      <div className="floating-stat"><span className="stat-icon"><ShieldCheck size={17}/></span><span><small>Estimated clear time</small><strong>4:32 <em>−18%</em></strong></span><span className="stat-trend"><ArrowDownRight size={13}/></span></div>
      <div className="floating-note"><span className="note-check"><Check size={12}/></span> No bottlenecks predicted</div>
    </div>
  )
}

function LandingPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('exodus-theme') === 'dark' ? 'dark' : 'light')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { window.localStorage.setItem('exodus-theme', theme) }, [theme])
  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')
  return (
    <div className="landing" data-theme={theme} id="top">
      <header className="site-header"><div className="nav-inner"><Brand/><nav className={menuOpen ? 'site-nav nav-open' : 'site-nav'}><a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a><a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="#security" onClick={() => setMenuOpen(false)}>Safety & trust</a><a className="mobile-contact" href="mailto:hello@exodus.ai">Talk to our team <ArrowRight size={14}/></a></nav><div className="nav-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>}</button><a className="nav-contact" href="mailto:hello@exodus.ai">Talk to our team <ArrowRight size={14}/></a><button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}>{menuOpen ? <X size={19}/> : <Menu size={19}/>}</button></div></div></header>
      <main>
        <section className="hero"><div className="hero-inner"><div className="hero-copy"><div className="hero-eyebrow"><span className="eyebrow-icon"><Shield size={13}/></span> AI-POWERED EVACUATION PLANNING</div><h1>Exodus<span>Make every move count.</span></h1><p className="hero-description">Help your team prepare for the unexpected with intelligent evacuation simulations, safer routes, and a clearer view of what happens next.</p><div className="hero-buttons"><Link className="button-primary" to="/simulator">Launch Simulator <ArrowRight size={16}/></Link><a className="button-secondary" href="#how-it-works"><CirclePlay size={17}/> See how it works</a></div><div className="hero-proof"><div className="proof-avatars"><span>SA</span><span>MK</span><span>JT</span><span>+</span></div><div><strong>Built for the people responsible for everyone.</strong><small>Safety teams · Building operators · First responders</small></div></div></div><FloorPlanPreview/></div><div className="hero-bottom-rule"><span>PLAN WITH CLARITY</span><i/><span>RESPOND WITH CONFIDENCE</span><i/><span>PROTECT EVERYONE</span></div></section>
        <section className="trust-strip" id="security"><div className="trust-inner"><div className="trust-caption"><span className="trust-line"/>DESIGNED FOR REAL-WORLD COMPLEXITY</div><div className="trust-items"><span><ShieldCheck size={15}/> Safety-first by design</span><span><Layers3 size={15}/> Multi-floor aware</span><span><Wind size={15}/> Dynamic hazard modeling</span><span><Users size={15}/> People-centered planning</span></div></div></section>
        <section className="platform-section" id="platform"><div className="section-heading"><span className="section-kicker">A CLEARER WAY TO PREPARE</span><h2>From floor plan to <em>ready plan.</em></h2><p>One workspace to understand your building, test your response, and help everyone find a way out.</p></div><div className="benefit-grid">{benefits.map(({icon:Icon,title,text},index)=><article className="benefit-card" key={title}><span className="benefit-number">0{index+1}</span><span className="benefit-icon"><Icon size={19}/></span><h3>{title}</h3><p>{text}</p><a href="#how-it-works">Learn more <ArrowRight size={13}/></a></article>)}</div></section>
        <section className="how-section" id="how-it-works"><div className="how-copy"><span className="section-kicker">PREPARE BEFORE IT HAPPENS</span><h2>Rehearse the response.<br/><em>Not the emergency.</em></h2><p>Set a scenario, run a simulation, and see how people and conditions move through your building. Exodus makes preparedness tangible, so your team can make better decisions ahead of time.</p><a className="text-link" href="mailto:hello@exodus.ai">See Exodus in action <MoveUpRight size={14}/></a></div><div className="steps"><div className="step"><span className="step-count">01</span><div><h3>Bring your building into view</h3><p>Map your floors, exits, sensors, and accessibility needs.</p></div><Check size={15}/></div><div className="step"><span className="step-count">02</span><div><h3>Choose a scenario to explore</h3><p>Adjust the incident and conditions to fit your building.</p></div><Check size={15}/></div><div className="step"><span className="step-count">03</span><div><h3>Learn, refine, and be ready</h3><p>Review predicted flow and improve your response plan.</p></div><Check size={15}/></div></div></section>
        <section className="cta-section"><div className="cta-decoration cta-decoration-one"/><div className="cta-decoration cta-decoration-two"/><div className="cta-copy"><span className="cta-icon"><ShieldCheck size={18}/></span><div><span className="section-kicker">PREPAREDNESS STARTS HERE</span><h2>Build confidence before you need it.</h2><p>See how Exodus can help your team prepare for what’s next.</p></div></div><a className="cta-button" href="mailto:hello@exodus.ai">Talk to our team <ArrowRight size={15}/></a></section>
      </main>
      <footer className="site-footer"><div className="footer-top"><Brand/><span className="footer-motto">Clearer plans. Safer outcomes.</span><div className="footer-links"><a href="#platform">Platform</a><a href="#how-it-works">How it works</a><a href="#security">Safety & trust</a><a href="mailto:hello@exodus.ai">Contact</a></div><button className="footer-theme" onClick={toggleTheme}>{theme === 'light' ? <Moon size={14}/> : <Sun size={14}/>} {theme === 'light' ? 'Dark' : 'Light'} mode <ChevronDown size={12}/></button></div><div className="footer-bottom"><span>© 2026 Exodus Technologies</span><span>Designed to support safer decisions. Always follow your building’s emergency procedures.</span><a href="#top">Back to top ↑</a></div></footer>
    </div>
  )
}

export default LandingPage
