(() => {
  const gate = document.querySelector('#authGate');
  const form = document.querySelector('#authForm');
  const emailInput = document.querySelector('#authEmail');
  const passwordInput = document.querySelector('#authPassword');
  const submitButton = document.querySelector('#authSubmit');
  const switchButton = document.querySelector('#authSwitch');
  const demoButton = document.querySelector('#demoMode');
  const message = document.querySelector('#authMessage');
  const title = document.querySelector('#authTitle');
  const intro = document.querySelector('#authIntro');
  const logoutButton = document.querySelector('#logoutButton');
  const demoBanner = document.querySelector('#demoBanner');
  let mode = 'login';

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `auth-message ${kind}`;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const creating = mode === 'signup';
    title.textContent = creating ? 'Skapa ditt konto' : 'Logga in';
    intro.textContent = creating
      ? 'Skapa kontot med den e-postadress som Procella eller din styrelse har bjudit in.'
      : 'Använd ditt personliga konto för att öppna OVK-portalen.';
    submitButton.textContent = creating ? 'Skapa konto' : 'Logga in';
    switchButton.textContent = creating ? 'Jag har redan ett konto' : 'Skapa konto från inbjudan';
    passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
    setMessage('');
  }

  function openApp(profile, demo = false) {
    gate.hidden = true;
    document.body.classList.toggle('demo-mode', demo);
    demoBanner.hidden = !demo;
    logoutButton.hidden = demo || !profile;
    if (!profile) return;
    window.procellaCurrentProfile = profile;

    const initials = (profile.full_name || profile.email || 'P')
      .split(/[ .@]/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
    const roleNames = {
      procella_admin: 'Procella-administratör',
      procella_staff: 'Procella',
      board: 'Styrelse',
      resident: 'Boende'
    };
    document.querySelector('.avatar').textContent = initials;
    document.querySelector('.user strong').textContent = profile.full_name || profile.email;
    document.querySelector('.user small').textContent = roleNames[profile.role] || 'Användare';
  }

  async function loadProfile(userId) {
    const { data, error } = await window.procellaDb
      .from('profiles')
      .select('id,email,full_name,role,brf_id,apartment_id,active')
      .eq('id', userId)
      .single();
    if (error) throw error;
    if (!data.active) throw new Error('Kontot är inaktiverat. Kontakta Procella.');
    return data;
  }

  async function applySession(session) {
    if (!session?.user) return;
    try {
      setMessage('Öppnar portalen…');
      const profile = await loadProfile(session.user.id);
      openApp(profile, false);
      window.dispatchEvent(new CustomEvent('procella:session', { detail: { session, profile } }));
    } catch (error) {
      setMessage(error.message || 'Kunde inte läsa användarprofilen.', 'error');
    }
  }

  async function initialize() {
    if (!window.supabase || !window.PROCELLA_SUPABASE) {
      setMessage('Kunde inte ansluta till inloggningen. Kontrollera internetanslutningen.', 'error');
      return;
    }
    window.procellaDb = window.supabase.createClient(
      window.PROCELLA_SUPABASE.url,
      window.PROCELLA_SUPABASE.publishableKey,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
    const { data } = await window.procellaDb.auth.getSession();
    if (data.session) await applySession(data.session);
    window.procellaDb.auth.onAuthStateChange((_event, session) => {
      if (session) applySession(session);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage(mode === 'signup' ? 'Skapar kontot…' : 'Loggar in…');
    submitButton.disabled = true;
    try {
      if (mode === 'signup') {
        const { data, error } = await window.procellaDb.auth.signUp({
          email: emailInput.value.trim(),
          password: passwordInput.value,
          options: { data: { full_name: 'Kewin Richert' } }
        });
        if (error) throw error;
        if (data.session) await applySession(data.session);
        else setMessage('Kontot är skapat. Öppna bekräftelselänken som skickats till din e-post.', 'success');
      } else {
        const { data, error } = await window.procellaDb.auth.signInWithPassword({
          email: emailInput.value.trim(),
          password: passwordInput.value
        });
        if (error) throw error;
        await applySession(data.session);
      }
    } catch (error) {
      setMessage(error.message || 'Något gick fel vid inloggningen.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  switchButton.addEventListener('click', () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    if (mode === 'login') emailInput.readOnly = false;
  });
  demoButton.addEventListener('click', () => openApp(null, true));
  logoutButton.addEventListener('click', async () => {
    await window.procellaDb.auth.signOut();
    window.location.reload();
  });

  const invitationParams = new URLSearchParams(window.location.search);
  if (invitationParams.get('invite') === '1') {
    setMode('signup');
    emailInput.value = invitationParams.get('email') || '';
    intro.textContent = 'Du är inbjuden till Procella OVK. Skapa ett lösenord för att aktivera ditt konto.';
    emailInput.readOnly = Boolean(emailInput.value);
  }

  initialize();
})();
