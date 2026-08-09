import React, { useState, useRef, useEffect } from 'react';
import Tooltip from './ui/Tooltip';
import { useQueryClient } from '@tanstack/react-query';
import { SUGGESTED_PROMPTS } from '../lib/keithKnowledge';
import { useAuth } from '../contexts/AuthContext';
import { announceFloatingPanelOpen, onFloatingPanelOpen, announceFloatingPanelClosed } from '../lib/floatingPanels';
import { renderMarkdownLite } from '../lib/keithMarkdown';
import { paletteSummary } from '../lib/skillSummary';

const KEITH_CLIENT_TIMEOUT_MS   = 28000;
const KEITH_PREFETCH_CEILING_MS = 5000;

export default function Keith({ activeTab, setActiveTab, cohortName, cohortId, supabase, isAuthenticated }) {
  const { userProfile } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen,      setIsOpen]      = useState(false);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [isTyping,    setIsTyping]    = useState(false);
  const [copiedId,    setCopiedId]    = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [toolExpanded, setToolExpanded] = useState({});
  // KEITH-MODEL-SELECT-1: user model selection (auto | haiku | sonnet). The
  // server enforces the allowlist; this control only offers what the role may
  // use, and the choice persists per user.
  const modelStorageKey = `keith-model-${userProfile?.id || 'anon'}`;
  const [chatModel, setChatModel] = useState(() => {
    try {
      const v = localStorage.getItem(`keith-model-${userProfile?.id || 'anon'}`);
      return ['auto', 'haiku', 'sonnet'].includes(v) ? v : 'auto';
    } catch { return 'auto'; }
  });
  const sonnetAllowed = userProfile?.is_owner === true || String(userProfile?.role || '').toLowerCase() === 'admin';
  const modelChoices = sonnetAllowed ? ['auto', 'haiku', 'sonnet'] : ['auto', 'haiku'];
  const MODEL_LABELS = { auto: 'Auto', haiku: 'Haiku 4.5', sonnet: 'Sonnet 4.5' };
  const pickModel = (value) => {
    const v = modelChoices.includes(value) ? value : 'auto';
    setChatModel(v);
    try { localStorage.setItem(modelStorageKey, v); } catch { /* private mode */ }
  };
  // KEITH-SLASH-SKILLS-1: "/" opens the Skills menu, populated once per panel
  // open from the canonical registry (server-filtered to this user's roles).
  const [skillCatalog, setSkillCatalog] = useState(null); // null = not fetched
  const [slashIndex, setSlashIndex] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);            // KEITH-CHAT-UX-1: scroll container, for near-bottom detection
  const nearBottomRef = useRef(true);      // KEITH-CHAT-UX-1: true while the user is near the latest message

  if (!isAuthenticated) return null;

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // KEITH-CHAT-UX-1: track whether the user is near the bottom so new Keith replies stick to the
  // latest message, but we never yank the user down while they scroll up to read earlier messages.
  const handleListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // New messages: scroll to bottom when the user just sent one, or when they were already near the
  // bottom. Reading older content (scrolled up) is left undisturbed. When the panel is closed the
  // end ref is unmounted, so scrollToBottom is a harmless no-op.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && (last.role === 'user' || nearBottomRef.current)) scrollToBottom('smooth');
  }, [messages]);

  // On open: focus the input and jump straight to the latest message (no animation).
  // MESSAGES-DOCK-1: the same effect now owns the dock edges - announcing the
  // closed state on every close path (toggle, backdrop, action, mutual dismiss)
  // so the Messages launcher can restore its idle position, and closing on
  // Escape like every other corner panel.
  useEffect(() => {
    if (!isOpen) { announceFloatingPanelClosed('keith'); return; }
    if (inputRef.current) inputRef.current.focus();
    nearBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('auto'));
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // UI-0.5: mutual dismiss - close this panel when another floating panel
  // (e.g. the UserMenu) announces it is opening. Closing only toggles isOpen;
  // chat/message state is untouched, exactly like the existing backdrop close.
  useEffect(() => onFloatingPanelOpen(source => {
    if (source !== 'keith') setIsOpen(false);
  }), []);


  const firstName = userProfile?.full_name?.split(' ')[0];
  // KEITH-REFRESH-1: the welcome states what Keith actually is today - governed
  // Knowledge Center answers first, live authorized data, Contacts lookups,
  // drafting, and Skills - in current product terminology.
  const welcomeMessage = {
    id: 'welcome',
    role: 'keith',
    text: `Hi${firstName ? `, ${firstName}` : ''}! I'm Keith, your ASPIRE assistant.\n\nI answer from ASPIRE's governed Knowledge Center and your live cohort data. Ask me to:\n\n• Answer program, policy, and routing questions from governed guidance\n• Check live status, placements, and On Campus Now\n• Look up people in ASPIRE Connect Contacts\n• Draft ASPIRE emails, signed as you\n\nType / to use a Skill, or just ask.`,
  };

  // Fetch the caller's invocable skills (metadata only) the first time the
  // slash menu is needed. Failure degrades to "no menu", never to an error.
  const ensureSkillCatalog = async () => {
    if (skillCatalog !== null) return;
    try {
      let accessToken = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || null;
      } catch { /* no session */ }
      const res = await fetch('/api/keith', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ mode: 'skills_catalog' }),
      });
      const json = await res.json().catch(() => null);
      setSkillCatalog(res.ok && Array.isArray(json?.skills) ? json.skills : []);
    } catch { setSkillCatalog([]); }
  };

  // The slash menu is a SEARCH surface: it is open while the user is still
  // choosing a command, and closed the moment the composer holds a committed
  // one. Committed = the token after "/" exactly names an invocable skill AND
  // a separator follows it, which is precisely the state a selection leaves
  // behind ("/some-skill-slug "). This is what dismisses the menu after
  // selecting - the reported bug was the menu surviving selection and showing
  // "No Skill matches" against the trailing space.
  const slashActive = input.startsWith('/');
  const slashBody = slashActive ? input.slice(1) : '';
  const slashToken = slashBody.split(/\s/)[0].toLowerCase();
  const slashCommitted = slashActive && /\s/.test(slashBody)
    && Array.isArray(skillCatalog) && skillCatalog.some(s => s.slug === slashToken);
  const slashMenuOpen = slashActive && !slashCommitted;
  const slashMatches = slashMenuOpen && Array.isArray(skillCatalog)
    ? skillCatalog.filter(s =>
        s.slug.toLowerCase().includes(slashToken)
        || String(s.name || '').toLowerCase().includes(slashToken))
    : [];

  const applySlashSelection = (skill) => {
    setInput(`/${skill.slug} `);
    setSlashIndex(0);
    inputRef.current?.focus();
  };

  const handleSend = async (messageText) => {
    if (isTyping) return;
    const text = messageText || input.trim();
    if (!text) return;

    // KEITH-SLASH-SKILLS-1: a leading /slug that names an invocable skill sends
    // that skill's canonical invocation (skill_slug) with the remaining text as
    // the skill's input. Natural-language trigger phrases continue to work
    // server-side exactly as before.
    let skillSlug = null;
    let outgoingText = text;
    const slashMatch = /^\/([a-z0-9][a-z0-9-]*)\s*(.*)$/s.exec(text);
    if (slashMatch && Array.isArray(skillCatalog) && skillCatalog.some(s => s.slug === slashMatch[1])) {
      skillSlug = slashMatch[1];
      outgoingText = slashMatch[2].trim() || text;
    }

    const userMessage = { id: Date.now(), role: 'user', text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Include last 10 messages for context window efficiency. For a slash-skill
    // invocation, the OUTGOING text is the skill input (e.g. the student name)
    // while the displayed message keeps what the user typed.
    const conversationHistory = [...messages, { ...userMessage, text: outgoingText }].slice(-10);

    // Read live cohort data from the React Query cache
    // ON-CAMPUS-NOW-UX-1: the obsolete onCampusToday read was removed. It read the phantom
    // key ['on_campus_today', …] that no query ever wrote (always []), and Keith now derives
    // On Campus Now server-authoritatively in api/keith.js (KEITH-ON-CAMPUS-NOW-1).
    const allCohorts = queryClient.getQueryData(['cohorts_all']) || [];
    const liveData = {
      activeCohortId:   cohortId,
      cohort:           allCohorts.find(c => c.id === cohortId) || null,
      students:         queryClient.getQueryData(['students_in_cohort', cohortId]) || [],
      cohorts:          allCohorts,
      units:            queryClient.getQueryData(['units_cohort', cohortId]) || [],
      matches:          queryClient.getQueryData(['embed_matches', cohortId]) || [],
      shiftLogProgress: queryClient.getQueryData(['shift_log_progress', cohortId]) || {},
    };

    // Bounded parallel prefetch - backend has authoritative data if any time out
    if (cohortId) {
      const prefetches = [];
      if (liveData.students.length === 0)
        prefetches.push(queryClient.prefetchQuery({
          queryKey: ['students_in_cohort', cohortId],
          queryFn: async () => {
            const { data } = await supabase.from('students').select('*').eq('cohort_id', cohortId);
            return data || [];
          },
        }));
      if (liveData.units.length === 0)
        prefetches.push(queryClient.prefetchQuery({
          queryKey: ['units_cohort', cohortId],
          queryFn: async () => {
            const { data } = await supabase.from('units').select('*').eq('cohort_id', cohortId);
            return data || [];
          },
        }));
      if (Object.keys(liveData.shiftLogProgress).length === 0)
        prefetches.push(queryClient.prefetchQuery({
          queryKey: ['shift_log_progress', cohortId],
          queryFn: async () => {
            const { data } = await supabase
              .from('student_shift_logs')
              .select('student_id, total_hours, status')
              .eq('cohort_id', cohortId)
              .in('status', ['Auto-Accepted', 'Approved']);
            const map = {};
            (data || []).forEach(log => {
              if (!map[log.student_id]) map[log.student_id] = 0;
              map[log.student_id] += parseFloat(log.total_hours) || 0;
            });
            return map;
          },
        }));
      if (liveData.matches.length === 0)
        prefetches.push(queryClient.prefetchQuery({
          queryKey: ['embed_matches', cohortId],
          queryFn: async () => {
            const { data } = await supabase
              .from('matches')
              .select('*, student:students(id, cohort_id), unit:units(id, unit_name, division)')
              .eq('cohort_id', cohortId);
            return data || [];
          },
        }));

      if (prefetches.length > 0) {
        let prefetchTimeoutId;
        await Promise.race([
          Promise.allSettled(prefetches),
          new Promise(resolve => { prefetchTimeoutId = setTimeout(resolve, KEITH_PREFETCH_CEILING_MS); }),
        ]);
        clearTimeout(prefetchTimeoutId);
        // Refresh liveData from cache - picks up whatever resolved within the ceiling
        liveData.students         = queryClient.getQueryData(['students_in_cohort', cohortId]) || liveData.students;
        liveData.units            = queryClient.getQueryData(['units_cohort', cohortId]) || liveData.units;
        liveData.shiftLogProgress = queryClient.getQueryData(['shift_log_progress', cohortId]) || liveData.shiftLogProgress;
        liveData.matches          = queryClient.getQueryData(['embed_matches', cohortId]) || liveData.matches;
      }
    }

    const abortController = new AbortController();
    const clientTimeoutId = setTimeout(() => abortController.abort(), KEITH_CLIENT_TIMEOUT_MS);

    try {
      try {
        // WS1: forward the Supabase access token so the server can verify identity
        // and authorize tools server-side (req.body identity is no longer trusted).
        let accessToken = null;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          accessToken = session?.access_token || null;
        } catch { /* no session → server returns 401 */ }

        const response = await fetch('/api/keith', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            messages: conversationHistory,
            liveData,
            cohortName,
            chat_model: chatModel,
            ...(skillSlug ? { skill_slug: skillSlug } : {}),
            userProfile: userProfile ? {
              full_name: userProfile.full_name,
              email:     userProfile.email,
              role:      userProfile.role,
              is_owner:  userProfile.is_owner,
            } : null,
          }),
          signal: abortController.signal,
        });
        clearTimeout(clientTimeoutId);

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          setMessages(prev => [...prev, {
            id: Date.now() + 1, role: 'keith',
            text: data.response, isAI: true,
            hasCopy: data.response?.includes('Subject:'),
            tool_calls: data.tool_calls || [],
          }]);
          return;
        }

        // Transient error (overloaded, rate limit, etc.) - show friendly message + retry
        if (data.transient) {
          setMessages(prev => [...prev, {
            id: Date.now() + 1, role: 'keith',
            text: data.response || "Keith is briefly unavailable. Try again in a moment.",
            isAI: false, canRetry: true, retryText: text,
          }]);
          return;
        }

        // Non-transient error - log details but show a clean message
        console.error('Keith API error:', response.status, data);
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'keith',
          text: `Something went wrong (${response.status}). ${data.error || 'Unknown error'}.`,
          isAI: false,
        }]);
      } catch (fetchErr) {
        clearTimeout(clientTimeoutId);
        if (fetchErr.name === 'AbortError' || fetchErr instanceof TypeError) {
          setMessages(prev => [...prev, {
            id: Date.now() + 1, role: 'keith',
            text: 'Keith could not complete that request. Please try again.',
            isAI: false, canRetry: true, retryText: text,
          }]);
          return;
        }
        throw fetchErr;
      }
    } catch (err) {
      console.warn('Keith API call failed:', err.message);
      // KT-5: no legacy static ASPIRE fallback. If the API is unreachable, show a
      // neutral unavailable message rather than answering from retired static content.
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'keith',
        text: "Keith is temporarily unavailable. Please try again in a moment. For current ASPIRE guidance, check the Knowledge Center or verify with the ASPIRE Owner or Admin.",
        isAI: false, canRetry: true, retryText: text,
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleAction = (action) => {
    if (!action) return;
    if (action.type === 'tab') {
      setActiveTab(action.tab);
      setIsOpen(false);
    }
    if (action.type === 'bell') {
      document.getElementById('keith-bell-trigger')?.click();
      setIsOpen(false);
    }
  };

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatText = (text) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
    ));
  };

  return (
    <>
      {/* Tooltip - sits to the LEFT of the orb (MESSAGES-AUTOSCROLL-1: the
          Messages shortcut now occupies the space directly above Keith, so the
          tooltip no longer floats up into it). */}
      {showTooltip && !isOpen && (
        <div style={{
          position: 'fixed',
          bottom: '38px',
          right: '96px',
          background: '#1d2567',
          color: '#ffffff',
          fontFamily: 'DM Sans',
          fontSize: '12px',
          fontWeight: 500,
          padding: '6px 12px',
          borderRadius: '8px',
          whiteSpace: 'nowrap',
          zIndex: 1001,
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(29,37,103,0.25)',
        }}>
          Ask Keith
        </div>
      )}

      {/* Floating button */}
      <button
        data-tour="keith-orb"
        onClick={() => {
          const next = !isOpen;
          if (next) announceFloatingPanelOpen('keith'); // UI-0.5: closes an open UserMenu
          setIsOpen(next);
        }}
        aria-label="Ask Keith"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0',
          zIndex: 1000,
          transition: 'transform 0.2s ease',
          transform: isOpen ? 'scale(0.95)' : 'scale(1)',
        }}
        onMouseEnter={e => { setShowTooltip(true); if (!isOpen) e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { setShowTooltip(false); if (!isOpen) e.currentTarget.style.transform = isOpen ? 'scale(0.95)' : 'scale(1)'; }}
      >
        {/* Orb */}
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          position: 'relative',
          overflow: 'hidden',
          background: 'radial-gradient(circle at 35% 35%, #1e0a5e, #060318)',
          boxShadow: isOpen
            ? '0 0 0 2px rgba(139,92,246,0.6), 0 0 24px rgba(99,102,241,0.7), 0 0 48px rgba(56,189,248,0.35)'
            : '0 0 0 1.5px rgba(99,102,241,0.4), 0 0 14px rgba(99,102,241,0.35), 0 4px 20px rgba(0,0,0,0.5)',
          transition: 'box-shadow 0.3s ease',
        }}>
          {/* Purple swirl arm - rotates clockwise */}
          <div style={{
            position: 'absolute',
            inset: '-8px',
            borderRadius: '42% 58% 65% 35% / 38% 42% 58% 62%',
            background: 'linear-gradient(140deg, rgba(167,139,250,0.92) 0%, rgba(109,40,217,0.55) 45%, transparent 75%)',
            animation: `keithSpin ${isOpen ? '2.5s' : '4s'} linear infinite`,
            filter: 'blur(2.5px)',
          }} />
          {/* Cyan swirl arm - rotates counter-clockwise */}
          <div style={{
            position: 'absolute',
            inset: '-8px',
            borderRadius: '58% 42% 35% 65% / 62% 58% 42% 38%',
            background: 'linear-gradient(320deg, rgba(56,189,248,0.92) 0%, rgba(14,165,233,0.55) 45%, transparent 75%)',
            animation: `keithSpin ${isOpen ? '2.5s' : '4s'} linear infinite reverse`,
            filter: 'blur(2.5px)',
          }} />
          {/* Inner glow layer */}
          <div style={{
            position: 'absolute',
            inset: '8px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 45% 40%, rgba(99,102,241,0.5) 0%, transparent 70%)',
            animation: 'keithGlow 2.5s ease-in-out infinite',
          }} />
          {/* Bright center glow */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(186,230,253,0.75) 40%, transparent 100%)',
            animation: 'keithPulse 2.5s ease-in-out infinite',
          }} />
          {/* Outer rim highlight */}
          <div style={{
            position: 'absolute',
            inset: '0',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12) 0%, transparent 60%)',
            pointerEvents: 'none',
          }} />
        </div>
      </button>

      {/* Drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.15)',
              zIndex: 998,
            }}
          />

          {/* Drawer panel */}
          <div style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            width: '400px',
            // KEITH-CHAT-UX-1: taller, responsive height. Caps at 720px on large screens and shrinks
            // with the viewport, always leaving ~160px of vertical clearance (bottom offset + top gap)
            // so the panel never covers the app header. minHeight is itself capped to the same
            // available space so it can never force overflow on short screens.
            height: 'min(720px, calc(100vh - 160px))',
            minHeight: 'min(360px, calc(100vh - 160px))',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 999,
            animation: 'keithSlideIn 0.2s ease',
          }}>

            {/* Header */}
            <div style={{
              background: '#1d2567',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
            }}>
              {/* Header orb - static, no animation */}
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                position: 'relative', overflow: 'hidden', flexShrink: 0,
                background: 'radial-gradient(circle at 35% 35%, #1e0a5e, #060318)',
                boxShadow: '0 0 0 1px rgba(99,102,241,0.5), 0 0 8px rgba(99,102,241,0.3)',
              }}>
                <div style={{ position: 'absolute', inset: '-4px', borderRadius: '42% 58% 65% 35% / 38% 42% 58% 62%', background: 'linear-gradient(140deg, rgba(167,139,250,0.85) 0%, rgba(109,40,217,0.5) 45%, transparent 75%)', filter: 'blur(1.5px)' }} />
                <div style={{ position: 'absolute', inset: '-4px', borderRadius: '58% 42% 35% 65% / 62% 58% 42% 38%', background: 'linear-gradient(320deg, rgba(56,189,248,0.85) 0%, rgba(14,165,233,0.5) 45%, transparent 75%)', filter: 'blur(1.5px)' }} />
                <div style={{ position: 'absolute', inset: '5px', borderRadius: '50%', background: 'radial-gradient(circle at 45% 40%, rgba(99,102,241,0.45) 0%, transparent 70%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '10px', height: '10px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(186,230,253,0.7) 40%, transparent 100%)' }} />
                <div style={{ position: 'absolute', inset: '0', borderRadius: '50%', background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12) 0%, transparent 60%)', pointerEvents: 'none' }} />
              </div>
              <div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '16px', color: '#ffffff' }}>Keith</div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 400, fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>ASPIRE Assistant</div>
              </div>
              <Tooltip label="New conversation" placement="bottom">
              <button
                onClick={() => setMessages([])}
                style={{
                  marginLeft: 'auto',
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                  padding: '4px 8px', fontSize: '13px',
                  fontFamily: 'DM Sans', borderRadius: '6px',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
              >↺ New</button>
              </Tooltip>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.65)', cursor: 'pointer',
                  fontSize: '18px', lineHeight: 1, padding: '4px',
                }}
              >×</button>
            </div>

            {/* Messages */}
            <div ref={listRef} onScroll={handleListScroll} style={{
              flex: 1, overflowY: 'auto',
              padding: '16px',
              display: 'flex', flexDirection: 'column', gap: '12px',
              minHeight: 0,
            }}>
              {/* Welcome */}
              <div style={{
                background: '#f0f4ff',
                border: '1px solid #e0e7ff',
                borderRadius: '12px 12px 12px 4px',
                padding: '12px 14px',
                maxWidth: '90%',
              }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: '13px', color: '#374151', lineHeight: 1.6 }}>
                  {renderMarkdownLite(welcomeMessage.text)}
                </div>
              </div>

              {/* Suggested prompts - only show when no messages yet */}
              {messages.length === 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                  {SUGGESTED_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      disabled={isTyping}
                      onClick={() => handleSend(prompt.label)}
                      style={{
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: '20px',
                        padding: '5px 12px',
                        fontFamily: 'DM Sans',
                        fontSize: '12px',
                        color: '#374151',
                        cursor: isTyping ? 'default' : 'pointer',
                        opacity: isTyping ? 0.45 : 1,
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                        pointerEvents: isTyping ? 'none' : 'auto',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = '#eff6ff';
                        e.currentTarget.style.borderColor = '#bfdbfe';
                        e.currentTarget.style.color = '#1d4ed8';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = '#f9fafb';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                        e.currentTarget.style.color = '#374151';
                      }}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Conversation messages */}
              {messages.map(msg => (
                <div key={msg.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '6px',
                }}>
                  <div style={{
                    background: msg.role === 'user' ? '#1d2567' : '#f0f4ff',
                    border: msg.role === 'user' ? 'none' : '1px solid #e0e7ff',
                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '10px 14px',
                    maxWidth: '88%',
                  }}>
                    <div style={{
                      fontFamily: 'DM Sans', fontSize: '13px', lineHeight: 1.6,
                      color: msg.role === 'user' ? '#ffffff' : '#374151',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {/* KEITH-CHAT-UX-1: Keith replies render as safe Markdown (React elements only);
                          user messages stay plain text. */}
                      {msg.role === 'keith' ? renderMarkdownLite(msg.text) : formatText(msg.text)}
                    </div>
                    {/* KEITH-REFRESH-1: only real Keith answers carry a badge;
                        the prototype-era fallback label is retired. */}
                    {msg.role === 'keith' && msg.isAI && (
                      <div style={{ fontSize: '9px', color: '#166534', marginTop: '2px', paddingLeft: '2px' }}>
                        ✦ Keith
                      </div>
                    )}

                    {/* Tool calls disclosure */}
                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          onClick={() => setToolExpanded(p => ({ ...p, [msg.id]: !p[msg.id] }))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontFamily: 'DM Sans, sans-serif', fontSize: 10,
                            color: '#1D2567', padding: '2px 0', display: 'flex',
                            alignItems: 'center', gap: 4, opacity: 0.75,
                          }}
                        >
                          <span>{toolExpanded[msg.id] ? '▾' : '▸'}</span>
                          <span>Looked at: {msg.tool_calls.map(t => t.tool).join(', ')}</span>
                        </button>
                        {toolExpanded[msg.id] && (
                          <div style={{
                            marginTop: 4, padding: '6px 10px',
                            background: 'rgba(29,37,103,0.04)',
                            borderRadius: 6, borderLeft: '2px solid #1D2567',
                            display: 'flex', flexDirection: 'column', gap: 3,
                          }}>
                            {msg.tool_calls.map((tc, i) => (
                              <div key={i} style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 10, color: '#475467' }}>
                                <span style={{ fontWeight: 600, color: '#1D2567' }}>{tc.tool}</span>
                                {': '}
                                {tc.result_summary}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Copy button for email drafts */}
                  {/* Retry button for transient errors */}
                  {msg.canRetry && (
                    <button
                      onClick={() => handleSend(msg.retryText)}
                      style={{
                        background: '#fff7ed', border: '1px solid #fed7aa',
                        borderRadius: '8px', padding: '4px 10px',
                        fontFamily: 'DM Sans', fontSize: '11px',
                        color: '#c2410c', cursor: 'pointer',
                      }}
                    >
                      ↺ Try again
                    </button>
                  )}

                  {msg.hasCopy && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.text)}
                      style={{
                        background: copiedId === msg.id ? '#dcfce7' : '#f9fafb',
                        border: `1px solid ${copiedId === msg.id ? '#86efac' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        padding: '4px 10px',
                        fontFamily: 'DM Sans', fontSize: '11px',
                        color: copiedId === msg.id ? '#166534' : '#6b7280',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedId === msg.id ? '✓ Copied' : 'Copy Email'}
                    </button>
                  )}

                  {/* Navigation action */}
                  {msg.action && (
                    <button
                      onClick={() => handleAction(msg.action)}
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        padding: '4px 10px',
                        fontFamily: 'DM Sans', fontSize: '11px',
                        color: '#1d4ed8',
                        cursor: 'pointer',
                      }}
                    >
                      → {msg.action.label}
                    </button>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div style={{
                  background: '#f0f4ff',
                  border: '1px solid #e0e7ff',
                  borderRadius: '12px 12px 12px 4px',
                  padding: '10px 14px',
                  width: 'fit-content',
                }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#9faff8',
                        animation: `keithDot 1.2s ease infinite ${i * 0.2}s`,
                      }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #f3f4f6',
              display: 'flex',
              gap: '8px',
              flexShrink: 0,
              position: 'relative',
            }}>
              {/* KEITH-SLASH-SKILLS-1: the Skills menu. Rendered while the user
                  is SEARCHING for a command; a committed selection closes it.
                  ArrowUp/Down + Enter, or click, selects. */}
              {slashMenuOpen && skillCatalog !== null && (
                slashMatches.length > 0 ? (
                  <div role="listbox" aria-label="Skills" style={{
                    position: 'absolute', bottom: '100%', left: 16, right: 16,
                    marginBottom: 4, background: '#ffffff',
                    border: '1px solid #e0e7ff', borderRadius: 10,
                    boxShadow: '0 6px 24px rgba(29,37,103,0.16)',
                    maxHeight: 180, overflowY: 'auto', zIndex: 5,
                  }}>
                    {slashMatches.map((s, i) => (
                      <div
                        key={s.slug}
                        role="option"
                        aria-selected={i === slashIndex}
                        onMouseDown={e => { e.preventDefault(); applySlashSelection(s); }}
                        onMouseEnter={() => setSlashIndex(i)}
                        style={{
                          padding: '8px 12px', cursor: 'pointer',
                          background: i === slashIndex ? '#eef2ff' : 'transparent',
                        }}
                      >
                        <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 600, color: '#1d2567' }}>/{s.slug}</div>
                        {/* SKILL-PALETTE-1: one concise line, derived at render
                            time. The stored description, trigger guidance,
                            instructions and references are untouched, and the
                            detail drawer still shows the full text. */}
                        {paletteSummary(s) && (
                          <div style={{
                            fontFamily: 'DM Sans', fontSize: 11, color: '#6b7280', marginTop: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{paletteSummary(s)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    position: 'absolute', bottom: '100%', left: 16, right: 16, marginBottom: 4,
                    background: '#ffffff', border: '1px solid #e0e7ff', borderRadius: 10,
                    boxShadow: '0 6px 24px rgba(29,37,103,0.16)', padding: '8px 12px',
                    fontFamily: 'DM Sans', fontSize: 11.5, color: '#6b7280', zIndex: 5,
                  }}>
                    {skillCatalog.length === 0 ? 'No Skills are available to your role.' : 'No Skill matches. Keep typing or press Escape.'}
                  </div>
                )
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={e => {
                  const v = e.target.value;
                  setInput(v);
                  setSlashIndex(0);
                  if (v.startsWith('/')) ensureSkillCatalog();
                }}
                onKeyDown={e => {
                  // Escape dismisses the menu in EVERY open state, including
                  // "no matches" (it previously fell through and closed the
                  // whole panel), and never fires once the menu is closed.
                  if (slashMenuOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setInput(''); return; }
                  if (slashMenuOpen && slashMatches.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashMatches.length); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length); return; }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlashSelection(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="Ask Keith, or type / for Skills..."
                style={{
                  flex: 1,
                  border: '1px solid #e5e7eb',
                  borderRadius: '20px',
                  padding: '8px 14px',
                  fontFamily: 'DM Sans', fontSize: '13px',
                  color: '#374151',
                  outline: 'none',
                  background: '#f9fafb',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#9faff8'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isTyping}
                style={{
                  background: (input.trim() && !isTyping) ? '#1d2567' : '#e5e7eb',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px', height: '36px',
                  cursor: (input.trim() && !isTyping) ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>

            {/* Footer: current sources + the model control. */}
            <div style={{
              padding: '4px 16px 10px',
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'DM Sans', fontSize: '10px', color: '#9ca3af',
            }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Knowledge Center + live data · {cohortName || 'No cohort'}
              </span>
              {/* KEITH-MODEL-SELECT-1: Auto keeps Keith's normal routing; the
                  server enforces who may choose Sonnet. */}
              <select
                aria-label="Model"
                value={chatModel}
                onChange={e => pickModel(e.target.value)}
                style={{
                  marginLeft: 'auto', flexShrink: 0,
                  fontFamily: 'DM Sans', fontSize: '10px', color: '#6b7280',
                  border: '1px solid #e5e7eb', borderRadius: 6,
                  background: '#f9fafb', padding: '2px 4px', cursor: 'pointer',
                }}
              >
                {modelChoices.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes keithSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes keithDot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes keithSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes keithPulse {
          0%, 100% { opacity: 0.75; transform: translate(-50%, -50%) scale(0.95); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes keithGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
