// Den publika VAPID-nyckeln får ligga i appen. Den privata nyckeln ska endast
// sparas som en hemlighet i Supabase Edge Functions.
window.PROCELLA_NOTIFICATIONS = Object.freeze({
  vapidPublicKey: 'LÄGG_IN_VAPID_PUBLIC_KEY_HÄR'
});
