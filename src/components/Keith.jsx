import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { greetingFor, capabilityLineFor, chipsFor, hasSeenWelcome, markWelcomeSeen } from '../lib/keithWelcome';
import { useAuth } from '../contexts/AuthContext';
import { announceFloatingPanelOpen, onFloatingPanelOpen, announceFloatingPanelClosed, onFloatingPanelClosed } from '../lib/floatingPanels';
import { onAskKeith } from '../lib/keithBus';
import { allowedActions, matchActions } from '../lib/home/launcherModel';
import { renderMarkdownLite } from '../lib/keithMarkdown';
import { paletteSummary } from '../lib/skillSummary';
import { findSlashToken, filterSkills, applySlashSelection } from '../lib/slashPalette';
import HumanizerPanel, { HumanizerToggle } from './keith/HumanizerPanel';
import KeithChatShell, { KeithWelcome, KeithChips, KeithMessage, KeithTyping, KeithFooter, KeithRetry } from './keith/KeithChatShell';

const KEITH_CLIENT_TIMEOUT_MS   = 28000;
const KEITH_OPUS_CLIENT_TIMEOUT_MS = 58000;
const KEITH_PREFETCH_CEILING_MS = 5000;

// `hideLauncher` supports shells that provide another Keith entry point while keeping the
// drawer reachable through askKeith(); the drawer's own close control still works.
export default function Keith({ activeTab, setActiveTab, cohortName, cohortId, supabase, isAuthenticated, hideLauncher = false }) {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen,      setIsOpen]      = useState(false);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [isTyping,    setIsTyping]    = useState(false);
  const [copiedId,    setCopiedId]    = useState(null);
  const [messagesOpen, setMessagesOpen] = useState(false);
  // KEITH-HUMANIZER-2: the footer's Humanizer button opens the widget inside the panel, under the chat.
  const [humanizerOpen, setHumanizerOpen] = useState(false);
  const [toolExpanded, setToolExpanded] = useState({});
  // KEITH-MODEL-SELECT-1: user model selection (auto | haiku | sonnet | opus). The
  // server enforces the allowlist; this control only offers what the role may
  // use, and the choice persists per user.
  const modelStorageKey = `keith-model-${userProfile?.id || 'anon'}`;
  const [chatModel, setChatModel] = useState(() => {
    try {
      const v = localStorage.getItem(`keith-model-${userProfile?.id || 'anon'}`);
      return ['auto', 'haiku', 'sonnet', 'opus'].includes(v) ? v : 'auto';
    } catch { return 'auto'; }
  });
  const sonnetAllowed = userProfile?.is_owner === true || String(userProfile?.role || '').toLowerCase() === 'admin';
  const modelChoices = [
    'auto', 'haiku',
    ...(sonnetAllowed ? ['sonnet'] : []),
    ...(userProfile?.is_owner === true ? ['opus'] : []),
  ];
  const MODEL_LABELS = { auto: 'Auto', haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5' };
  // A stored choice this account may not use is never sent: the server refuses Opus outright.
  const sentModel = modelChoices.includes(chatModel) ? chatModel : 'auto';
  const pickModel = (value) => {
    const v = modelChoices.includes(value) ? value : 'auto';
    setChatModel(v);
    try { localStorage.setItem(modelStorageKey, v); } catch { /* private mode */ }
  };
  // KEITH-SLASH-SKILLS-1: "/" opens the Skills menu, populated once per panel
  // open from the canonical registry (server-filtered to this user's roles).
  const [skillCatalog, setSkillCatalog] = useState(null); // null = not fetched
  const [slashIndex, setSlashIndex] = useState(0);
  // KEITH-SLASH-ANYWHERE-CLIENT-1: the palette is anchored to the caret, not to
  // position 0, so these two follow the cursor rather than the string.
  const [caretPos, setCaretPos] = useState(0);
  const [slashDismissedAt, setSlashDismissedAt] = useState(null); // token start Escape closed
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pendingCaretRef = useRef(null);    // caret to restore after a selection rewrites the input
  const listRef = useRef(null);            // KEITH-CHAT-UX-1: scroll container, for near-bottom detection
  const nearBottomRef = useRef(true);      // KEITH-CHAT-UX-1: true while the user is near the latest message

  // KEITH-SLASH-ANYWHERE-CLIENT-1: put the caret back where a palette
  // selection left it. React owns the input's value, so the DOM selection has
  // to be restored after the re-render that applies the new text; caretPos is
  // set alongside the value, so this effect only touches the DOM. It sits
  // above the early returns below to keep hook order unconditional.
  useEffect(() => {
    const want = pendingCaretRef.current;
    if (want == null) return;
    pendingCaretRef.current = null;
    const el = inputRef.current;
    if (el) el.setSelectionRange(want, want);
  }, [input]);

  // HOME-1: a question asked from elsewhere (the home page's "Ask Keith" row) opens the
  // drawer and sends it. handleSend is defined below, after the early returns, so the
  // subscription reaches it through a ref that an effect refreshes after every render.
  const askRef = useRef(null);
  // LAUNCHER-2: the launcher's own action list rides along with its question (see keithBus).
  const offerRef = useRef(null);
  useEffect(() => {
    // handleSend is a const declared after the early returns below. When one of them
    // fires (no session, a Viewer) the render never reaches that declaration, so the
    // binding is still in its temporal dead zone here; there is no Keith to ask then.
    try { askRef.current = handleSend; } catch { askRef.current = null; }
  });
  useEffect(() => onAskKeith((text, opts) => {
    offerRef.current = opts?.actions || null;
    announceFloatingPanelOpen('keith');
    setIsOpen(true);
    // Let the drawer mount and the input take focus before the message goes out.
    setTimeout(() => askRef.current?.(text), 0);
  }), []);

  // KEITH-FOUNDATION-1: the launcher orb plays once when the app first loads in a session, then once
  // on each hover or keyboard focus. Above the early returns to keep hook order unconditional.
  const [orbReplay, setOrbReplay] = useState(0);
  const replayOrb = () => setOrbReplay(n => n + 1);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem('keith-orb-intro') === '1'; sessionStorage.setItem('keith-orb-intro', '1'); } catch { /* private mode */ }
    if (seen) return undefined;
    const t = setTimeout(() => setOrbReplay(n => n + 1), 600);
    return () => clearTimeout(t);
  }, []);

  // KEITH-HOOKS-1: every hook sits above the two early returns below, so a session or role
  // that changes while Keith is mounted cannot change the hook order (React #310).
  // KEITH-WELCOME-1: the resolved role model gives Viewer no Keith access (the
  // server 403s before any context is assembled). The launcher now agrees
  // instead of offering a door that does not open. Chrome only - authorization
  // is unchanged and remains server-side.
  const keithHidden = !isAuthenticated || (userProfile?.role === 'viewer' && userProfile?.is_owner !== true);

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
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
  // KEITH-HOOKS-1: while Keith renders nothing (no session, a Viewer) there is no input to
  // focus and no drawer to close, so the effect stands down; the early returns used to keep it
  // from running at all in that state.
  useEffect(() => {
    if (keithHidden) return undefined;
    if (!isOpen) { announceFloatingPanelClosed('keith'); return undefined; }
    if (inputRef.current) inputRef.current.focus();
    nearBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('auto'));
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, keithHidden]);

  // UI-0.5: mutual dismiss - close this panel when another floating panel
  // (e.g. the UserMenu) announces it is opening. Closing only toggles isOpen;
  // chat/message state is untouched, exactly like the existing backdrop close.
  useEffect(() => onFloatingPanelOpen(source => {
    if (source !== 'keith') setIsOpen(false);
    setMessagesOpen(source === 'main-messages');
  }), []);
  useEffect(() => onFloatingPanelClosed(source => {
    if (source === 'main-messages') setMessagesOpen(false);
  }), []);

  if (keithHidden) return null;

  // KEITH-CHAT-UX-1: track whether the user is near the bottom so new Keith replies stick to the
  // latest message, but we never yank the user down while they scroll up to read earlier messages.
  const handleListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const firstName = userProfile?.full_name?.split(' ')[0];
  // KEITH-WELCOME-1: the welcome is computed, not recited. Time-of-day
  // greeting, a single role-aware capability sentence (full version once per
  // user; returning users get the light form), and role-aware chips - all
  // decided in src/lib/keithWelcome.js where they are tested. No bullet wall,
  // no tour, and nothing offered that this role cannot do.
  // "Returning" flips only between sessions: it is read per render but only
  // WRITTEN when the user actually engages (sends a message or closes the
  // panel), so the fuller sentence never swaps out mid-first-session. No new
  // hooks: a welcome flag does not justify one.
  const returning = hasSeenWelcome(userProfile?.id);
  const rememberWelcomed = () => { if (!returning) markWelcomeSeen(userProfile?.id); };
  const greeting = greetingFor(new Date(), firstName);
  const capabilityLine = capabilityLineFor({ role: userProfile?.role, isOwner: userProfile?.is_owner, cohortName });
  const chips = chipsFor({ role: userProfile?.role, isOwner: userProfile?.is_owner });

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

  // The slash menu is a SEARCH surface, anchored to the CARET. It is open while
  // the caret sits inside a command token - "/" starting a word, anywhere in
  // the message - and closes as soon as the caret leaves it. That is what
  // dismisses the menu after a selection: the caret lands past the command, not
  // inside it. (The reported bug was the menu surviving selection; before that
  // it was the menu never appearing unless "/" was the first character.)
  const slashToken = findSlashToken(input, caretPos);
  const slashMenuOpen = !!slashToken && slashDismissedAt !== slashToken.start;
  const slashMatches = slashMenuOpen ? filterSkills(skillCatalog, slashToken.query) : [];

  const chooseSkill = (skill) => {
    const next = applySlashSelection(input, slashToken, skill.slug);
    pendingCaretRef.current = next.caret;
    setInput(next.value);
    setCaretPos(next.caret);
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

    rememberWelcomed();
    const userMessage = { id: Date.now(), role: 'user', text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setCaretPos(0);
    setSlashDismissedAt(null);   // a dismissal belongs to one message, not the next
    setIsTyping(true);

    // LAUNCHER-2 (Owner, 2026-09-30: "keith should be able to understand the context if
    // typed"). A request that names something the app does ("upload a receipt", "look up
    // a phone number") is matched against the launcher's own actions, by the one rule in
    // launcherModel, and only among what this person may do. When every word lands, Keith
    // answers with the way there and does not call the model; when some do, the model
    // answers and the way there sits under its reply. Keith still takes no action itself.
    const pool = offerRef.current || allowedActions({
      isAdmin: ['owner', 'admin'].includes(userProfile?.role) || userProfile?.is_owner === true,
      isOwner: userProfile?.is_owner === true,
      canInterview: ['owner', 'admin', 'interviewer'].includes(userProfile?.role) || userProfile?.is_owner === true,
      isActive: userProfile?.is_active !== false,
    });
    offerRef.current = null;
    const matched = skillSlug ? [] : matchActions(text, pool);
    const wayThere = matched.slice(0, 3).map(m => ({ type: 'route', to: m.action.to, label: m.action.title }));
    if (matched[0]?.strong) {
      const [first] = matched;
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'keith', isAI: false, actions: wayThere,
        text: wayThere.length === 1 ? `${first.action.title} is in ${first.action.where}.` : 'Here is where you can do that.',
      }]);
      setIsTyping(false);
      return;
    }

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
    const clientTimeoutId = setTimeout(() => abortController.abort(), sentModel === 'opus' ? KEITH_OPUS_CLIENT_TIMEOUT_MS : KEITH_CLIENT_TIMEOUT_MS);

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
            chat_model: sentModel,
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
            actions: wayThere,
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
    if (action.type === 'route' && action.to) {
      navigate(action.to);
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

  // KEITH-FOUNDATION-1: the animated orb (KeithOrbVideo) plays once on the first load of a session
  // and once on hover or focus, loops while Keith is working (isTyping), and otherwise rests on its
  // poster. It is drawn by KeithChatShell, with the rest of the chat (RESIDENCY-KEITH-2).
  const formatText = (text) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
    ));
  };

  return (
    <KeithChatShell
      open={isOpen}
      busy={isTyping}
      replay={orbReplay}
      onReplay={replayOrb}
      onToggle={() => {
        const next = !isOpen;
        if (next) announceFloatingPanelOpen('keith'); // UI-0.5: closes an open UserMenu
        setIsOpen(next);
      }}
      onClose={() => { rememberWelcomed(); setIsOpen(false); }}
      onNew={() => setMessages([])}
      hideLauncher={hideLauncher}
      dock={humanizerOpen ? <HumanizerPanel /> : null}
      launcherProps={{ 'data-tour': 'keith-orb' }}
      launcherRight={messagesOpen && !isOpen ? '96px' : '24px'}
      tooltipRight={messagesOpen ? '168px' : '96px'}
      listRef={listRef}
      onListScroll={handleListScroll}
      endRef={messagesEndRef}
      inputOverlay={<>
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
                  onMouseDown={e => { e.preventDefault(); chooseSkill(s); }}
                  onMouseEnter={() => setSlashIndex(i)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    background: i === slashIndex ? '#eef2ff' : 'transparent',
                  }}
                >
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 12.5, fontWeight: 600, color: '#1d2567' }}>/{s.slug}</div>
                  {/* SKILL-PALETTE-1: one concise line, derived at render
                      time. The stored description, trigger guidance,
                      instructions and references are untouched, and the
                      detail drawer still shows the full text. */}
                  {paletteSummary(s) && (
                    <div style={{
                      fontFamily: 'Plus Jakarta Sans', fontSize: 11, color: '#6b7280', marginTop: 1,
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
              fontFamily: 'Plus Jakarta Sans', fontSize: 11.5, color: '#6b7280', zIndex: 5,
            }}>
              {skillCatalog.length === 0 ? 'No Skills are available to your role.' : 'No Skill matches. Keep typing or press Escape.'}
            </div>
          )
        )}
      </>}
      input={{
        ref: inputRef,
        value: input,
        onChange: e => {
          const v = e.target.value;
          const c = e.target.selectionStart ?? v.length;
          setInput(v);
          setCaretPos(c);
          setSlashIndex(0);
          // A token starting anywhere in the message needs the
          // catalogue, not only one at position 0.
          const tok = findSlashToken(v, c);
          if (tok) ensureSkillCatalog();
          // An Escape dismissal lasts as long as the token it closed;
          // once that token is gone, the next "/" opens the menu again.
          else setSlashDismissedAt(null);
        },
        // Clicking or arrowing through the text moves the palette with
        // the caret, so the menu tracks the token being edited.
        onSelect: e => setCaretPos(e.target.selectionStart ?? 0),
        onKeyUp: e => setCaretPos(e.target.selectionStart ?? 0),
        onKeyDown: e => {
          // Escape dismisses the menu in EVERY open state, including
          // "no matches" (it previously fell through and closed the
          // whole panel), and never fires once the menu is closed. It
          // dismisses ONLY the menu: it used to clear the composer,
          // which mid-sentence would delete the caller's message.
          if (slashMenuOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSlashDismissedAt(slashToken.start); return; }
          if (slashMenuOpen && slashMatches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashMatches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseSkill(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
        },
        placeholder: 'Ask anything, or type / for a Skill…',
        canSend: Boolean(input.trim()) && !isTyping,
        onSend: () => handleSend(),
      }}
      footer={
        <KeithFooter
          label={cohortName || 'No cohort'}
          models={modelChoices}
          value={sentModel}
          onChange={pickModel}
          labels={MODEL_LABELS}
          action={<HumanizerToggle open={humanizerOpen} onToggle={() => setHumanizerOpen(o => !o)} />}
        />
      }
    >
      {/* Welcome: greeting + one sentence, lighter on return visits. */}
      <KeithWelcome title={greeting}>
        {returning
          ? <>Ask anything, or type <span style={{ fontFamily: 'ui-monospace, monospace' }}>/</span> to use a Skill.</>
          : <>{capabilityLine} Ask anything, or type <span style={{ fontFamily: 'ui-monospace, monospace' }}>/</span> to use a Skill.</>}
      </KeithWelcome>

      {/* Suggested prompts - role-aware, at most four, empty state only */}
      {messages.length === 0 && <KeithChips chips={chips} disabled={isTyping} onPick={handleSend} />}

      {/* Conversation messages */}
      {messages.map(msg => (
        <KeithMessage
          key={msg.id}
          fromUser={msg.role === 'user'}
          ai={msg.role === 'keith' && msg.isAI}
          // KEITH-CHAT-UX-1: Keith replies render as safe Markdown (React elements only);
          // user messages stay plain text.
          body={msg.role === 'keith' ? renderMarkdownLite(msg.text) : formatText(msg.text)}
          inside={<>
              {/* Tool calls disclosure */}
              {msg.tool_calls && msg.tool_calls.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setToolExpanded(p => ({ ...p, [msg.id]: !p[msg.id] }))}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10,
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
                        <div key={i} style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#475467' }}>
                          <span style={{ fontWeight: 600, color: '#1D2567' }}>{tc.tool}</span>
                          {': '}
                          {tc.result_summary}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
          </>}
          after={<>
            {/* Copy button for email drafts */}
            {/* Retry button for transient errors */}
            {msg.canRetry && <KeithRetry onClick={() => handleSend(msg.retryText)} />}

            {msg.hasCopy && (
              <button
                onClick={() => handleCopy(msg.id, msg.text)}
                style={{
                  background: copiedId === msg.id ? '#dcfce7' : '#f9fafb',
                  border: `1px solid ${copiedId === msg.id ? '#86efac' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  padding: '4px 10px',
                  fontFamily: 'Plus Jakarta Sans', fontSize: '11px',
                  color: copiedId === msg.id ? '#166534' : '#6b7280',
                  cursor: 'pointer',
                }}
              >
                {copiedId === msg.id ? '✓ Copied' : 'Copy Email'}
              </button>
            )}

            {/* Navigation actions (LAUNCHER-2: a reply can carry more than one way there) */}
            {[msg.action, ...(msg.actions || [])].filter(Boolean).map((a, ai) => (
              <button
                key={ai}
                type="button"
                onClick={() => handleAction(a)}
                style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  padding: '4px 10px',
                  fontFamily: 'Plus Jakarta Sans', fontSize: '11px',
                  color: '#1d4ed8',
                  cursor: 'pointer',
                }}
              >
                → {a.label}
              </button>
            ))}
          </>}
        />
      ))}

      {/* Typing indicator */}
      {isTyping && <KeithTyping />}
    </KeithChatShell>
  );
}
