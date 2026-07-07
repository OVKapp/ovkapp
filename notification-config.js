// Den publika VAPID-nyckeln får ligga i appen. Den privata nyckeln ska endast
// sparas som en hemlighet i Supabase Edge Functions (se VAPID_PRIVATE_KEY i
// .env.local/.env.production, aldrig i den här filen).
//
// Generera ett eget lokalt nyckelpar med supabase/generate-vapid-keys.ps1 om du
// vill testa push-notiser lokalt, och klistra in den publika nyckeln nedan.
// Använd aldrig produktionens VAPID-nyckelpar lokalt.
window.PROCELLA_NOTIFICATIONS = Object.freeze({
  vapidPublicKey: 'LÄGG_IN_VAPID_PUBLIC_KEY_HÄR'
});
