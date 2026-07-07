// Dessa två värden är publika klientuppgifter. Lägg aldrig en secret/service-role-nyckel här.
//
// Växlar automatiskt till den lokala Supabase-instansen (Docker via `supabase start`)
// när sidan körs på localhost/127.0.0.1, annars används produktionsvärdena nedan.
// Motsvarande värden finns dokumenterade i .env.local respektive .env.production.
const PROCELLA_IS_LOCAL_DEV = ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.PROCELLA_SUPABASE = Object.freeze(PROCELLA_IS_LOCAL_DEV ? {
  url: 'http://127.0.0.1:54321',
  publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
} : {
  url: 'https://cqhpwjpxhbncfbuybjbj.supabase.co',
  publishableKey: 'sb_publishable_bW9TW-Xm81HcJTJY-qz-6Q_3VCdRfdm'
});
