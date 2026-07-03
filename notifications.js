(() => {
  let profile = null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]);
  const isPushConfigured = () => {
    const key = window.PROCELLA_NOTIFICATIONS?.vapidPublicKey || '';
    return key && !key.includes('LÄGG_IN_');
  };
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const secureEnough = () => location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  }

  async function getPreferences() {
    let { data, error } = await window.procellaDb.from('notification_preferences').select('profile_id,email_enabled,push_enabled').eq('profile_id', profile.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const result = await window.procellaDb.from('notification_preferences').insert({ profile_id: profile.id }).select('profile_id,email_enabled,push_enabled').single();
      if (result.error) throw result.error;
      data = result.data;
    }
    return data;
  }

  async function getCurrentSubscription() {
    if (!pushSupported() || !secureEnough()) return null;
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    return registration.pushManager.getSubscription();
  }

  async function renderSettings() {
    const container = document.querySelector('#notificationSettings');
    if (!container || !profile) return;
    container.innerHTML = '<div class="settings-loading compact"><span class="loading-spinner"></span><p>Hämtar notisinställningar…</p></div>';
    try {
      const preferences = await getPreferences();
      const subscription = await getCurrentSubscription();
      const pushReady = pushSupported() && secureEnough() && isPushConfigured();
      const reason = !secureEnough() ? 'Push aktiveras när portalen ligger på en säker webbadress.' : !pushSupported() ? 'Den här webbläsaren stöder inte pushnotiser.' : !isPushConfigured() ? 'Pushnyckeln behöver läggas in innan funktionen kan aktiveras.' : subscription ? 'Pushnotiser är aktiva på den här enheten.' : 'Aktivera push på den här enheten.';
      container.innerHTML = `<article class="panel notification-panel"><div class="panel-head"><div><h2>E-post och pushnotiser</h2><p>Välj hur du vill få besked om nya meddelanden.</p></div></div><div class="notification-option"><div><span class="notification-icon">@</span><div><strong>E-postnotiser</strong><p>Skickas till ${escapeHtml(profile.email)}.</p></div></div><label class="toggle"><input type="checkbox" data-email-notifications ${preferences.email_enabled ? 'checked' : ''}><span></span></label></div><div class="notification-option"><div><span class="notification-icon">●</span><div><strong>Pushnotiser</strong><p>${escapeHtml(reason)}</p></div></div><button class="${subscription ? 'secondary-button' : 'primary-button'} small-button" data-push-toggle ${pushReady ? '' : 'disabled'}>${subscription ? 'Stäng av på enheten' : 'Aktivera push'}</button></div></article>`;
      container.querySelector('[data-email-notifications]').addEventListener('change', updateEmailPreference);
      container.querySelector('[data-push-toggle]').addEventListener('click', () => subscription ? disablePush(subscription) : enablePush());
    } catch (error) {
      container.innerHTML = `<div class="setup-required panel"><strong>Notiser behöver installeras</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  async function updateEmailPreference(event) {
    const { error } = await window.procellaDb.from('notification_preferences').update({ email_enabled: event.target.checked, updated_at: new Date().toISOString() }).eq('profile_id', profile.id);
    if (error) { event.target.checked = !event.target.checked; window.procellaApp.showToast(error.message); }
    else window.procellaApp.showToast(event.target.checked ? 'E-postnotiser är aktiva' : 'E-postnotiser är avstängda');
  }

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Du behöver tillåta notiser i webbläsaren.');
      const registration = await navigator.serviceWorker.register('./service-worker.js');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(window.PROCELLA_NOTIFICATIONS.vapidPublicKey) });
      const serialized = subscription.toJSON();
      const { error: subscriptionError } = await window.procellaDb.from('push_subscriptions').upsert({ profile_id: profile.id, endpoint: serialized.endpoint, p256dh: serialized.keys.p256dh, auth_key: serialized.keys.auth, user_agent: navigator.userAgent, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
      if (subscriptionError) throw subscriptionError;
      const { error: preferenceError } = await window.procellaDb.from('notification_preferences').update({ push_enabled: true, updated_at: new Date().toISOString() }).eq('profile_id', profile.id);
      if (preferenceError) throw preferenceError;
      window.procellaApp.showToast('Pushnotiser är aktiverade');
      await renderSettings();
    } catch (error) { window.procellaApp.showToast(error.message || 'Pushnotiser kunde inte aktiveras'); }
  }

  async function disablePush(subscription) {
    try {
      await window.procellaDb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe();
      const { count } = await window.procellaDb.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('profile_id', profile.id);
      await window.procellaDb.from('notification_preferences').update({ push_enabled: (count || 0) > 0, updated_at: new Date().toISOString() }).eq('profile_id', profile.id);
      window.procellaApp.showToast('Pushnotiser är avstängda på enheten');
      await renderSettings();
    } catch (error) { window.procellaApp.showToast(error.message || 'Pushnotiser kunde inte stängas av'); }
  }

  async function notifyMessage(messageId) {
    if (!messageId || !window.procellaDb?.functions) return;
    try {
      const { error } = await window.procellaDb.functions.invoke('notify-message', { body: { message_id: messageId } });
      if (error) console.warn('Notiser kunde inte skickas:', error.message);
    } catch (error) { console.warn('Notiser kunde inte skickas:', error.message); }
  }

  window.procellaNotifications = { notifyMessage, renderSettings };
  window.addEventListener('procella:session', event => { profile = event.detail.profile; });
  window.addEventListener('procella:settings-rendered', renderSettings);
})();
