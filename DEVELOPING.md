# Lokal utvecklingsmiljö – Procella OVK

Den här guiden beskriver hur du kör hela applikationen lokalt (databas, Auth, Storage,
Edge Functions) med Supabase CLI och Docker, utan att röra produktionsdata.

Applikationen i sig är en ren statisk sida (HTML/CSS/vanilla JS, inget byggsteg), så
"lokal utveckling" handlar i praktiken om att köra en lokal Supabase-instans och peka
sidan mot den istället för mot produktionsprojektet.

## 1. Förutsättningar

- **Docker Desktop** (eller motsvarande Docker-motor), igång.
- **Supabase CLI**. Något av:
  - `npx supabase --version` (kräver inget installationssteg, `npx` följer med Node.js)
  - eller en global installation, se https://supabase.com/docs/guides/cli
- **Node.js 18+** (för seed-scriptet och en enkel lokal webbserver).
- Ett Git-klonat repo av detta projekt.

> Flödet nedan (`supabase start` → `db reset` → `seed-users-and-data.mjs`) är verifierat
> end-to-end mot Docker/Supabase CLI. Portar/nycklar kan ändå skilja sig mellan
> CLI-versioner – kör `supabase status` och jämför mot `.env.local` om något inte stämmer.

## 2. Starta den lokala Supabase-instansen

Kör i repo-roten:

```bash
npx supabase start
```

Första gången laddas Docker-images ner (Postgres, GoTrue/Auth, Storage, Studio,
Realtime, Kong m.fl.), vilket tar några minuter. Kommandot skriver ut lokala URL:er och
nycklar när det är klart, bland annat:

- API URL: `http://127.0.0.1:54321`
- DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio URL: `http://127.0.0.1:54323` (grafiskt gränssnitt mot databasen)
- Inbucket (lokal e-post): `http://127.0.0.1:54324`
- `anon key` och `service_role key`

Jämför dessa mot `.env.local` (skapa den från `.env.example` om den saknas) och
uppdatera vid behov – nycklarna är desamma varje gång så länge du inte återställer
CLI:ts lokala JWT-hemlighet.

Migrationerna i `supabase/migrations/` och grunddatan i `supabase/seed.sql` körs
automatiskt av `supabase start` (första gången) respektive `supabase db reset`.

## 3. Skapa testanvändare och exempeldata

`supabase/seed.sql` seedar bara det som är säkert att göra med ren SQL (BRF, fastighet,
lägenheter, inbjudningar). Auth-användarna och resten av exempeldatan (rum,
ventilationsdon, besiktning, avvikelse, dokument, bild i Storage) skapas av ett separat
Node-script, eftersom det använder Supabase Admin API istället för att gissa på interna
`auth.*`-tabeller:

```bash
node supabase/seed-users-and-data.mjs
```

Scriptet är säkert att köra flera gånger – redan skapade konton/rader hoppas över.

### Testkonton efter seed

| Roll | E-post | Lösenord |
|---|---|---|
| Admin (Procella, `procella_admin`) | `admin@local.test` | `Password123!` |
| Support (Procella, `procella_staff`) | `support@local.test` | `Password123!` |
| Styrelse (BRF Lokal Utveckling) | `board@local.test` | `Password123!` |
| Boende (lägenhet A-1101) | `resident@local.test` | `Password123!` |

Kontona bekräftas automatiskt lokalt (`enable_confirmations = false` i
`supabase/config.toml`), så du kan logga in direkt efter seed utan att öppna något
bekräftelsemejl.

## 4. Starta själva webbappen lokalt

Appen har inget byggsteg, så vilken statisk filserver som helst fungerar. Kör från
repo-roten (porten 8080 matchar `site_url` i `supabase/config.toml`):

```bash
npx serve -l 8080 .
# eller: python -m http.server 8080
```

Öppna `http://127.0.0.1:8080`. `supabase-config.js` upptäcker automatiskt att sidan körs
på `localhost`/`127.0.0.1` och pekar mot den lokala Supabase-instansen istället för
produktionen – ingen manuell växling behövs i frontend-koden.

## 5. Edge Functions lokalt

Starta alla funktioner i `supabase/functions/` med de lokala hemligheterna:

```bash
npx supabase functions serve --env-file .env.local
```

Funktionerna anropas då via `http://127.0.0.1:54321/functions/v1/<namn>`, vilket redan
är vad `window.procellaDb.functions.invoke(...)` i frontend-koden använder (samma
Supabase-klient, samma URL som resten av API:t).

### Externa tjänster – aldrig produktionsnycklar lokalt

| Tjänst | Lokalt | Kommentar |
|---|---|---|
| Stripe | Testnycklar (`sk_test_...`, `whsec_...`) | Skapa ett gratis Stripe-testläge-konto. Lämna tomt i `.env.local` för att låta `create-checkout`/`create-portal` svara med ett tydligt fel istället för att krascha. |
| Resend | Tom nyckel eller eget testkonto | Koden hanterar redan saknad `RESEND_API_KEY` (loggar/markerar som "skipped/failed" utan att krascha) – se `notify-message` och `send-invitation`. Vill du se faktiska mejl kan du peka `EMAIL_FROM` mot ett Resend-testkonto, eller läsa lokal utgående post i Inbucket på port 54324. |
| Webbpush (VAPID) | Egna nycklar via `supabase/generate-vapid-keys.ps1` | Klistra in den publika nyckeln i `notification-config.js` och den privata i `.env.local`. |
| `purge-expired-brfs` | `PURGE_CRON_SECRET=local-dev-secret` | Anropa manuellt lokalt med `curl -H "x-cron-secret: local-dev-secret" http://127.0.0.1:54321/functions/v1/purge-expired-brfs` – kör den **aldrig** mot produktion utan att först dubbelkolla vilka BRF:er som faktiskt är förfallna. |

## 6. Verifiera att allt är på plats

- **Studio** (`http://127.0.0.1:54323`) → Table editor: kontrollera att alla tabeller
  från `supabase/migrations/20240101000000_initial_schema.sql` m.fl. finns, att RLS är
  påslaget (grön "RLS enabled"-badge) och att policies syns under respektive tabell.
- **Database → Functions**: `is_procella`, `can_access_brf` m.fl. ska finnas.
- **Storage**: buckets `ventilation-media` och `ovk-documents` ska finnas (skapade av
  `initial_schema`-migrationen) och innehålla exempelfilerna från seed-scriptet.
- Logga in i appen som `board@local.test` och kontrollera att BRF Lokal Utveckling,
  lägenheterna, rummen, ventilationsdonen, besiktningen och avvikelsen visas.

## 7. Återställa databasen

```bash
npx supabase db reset
```

Detta kör om **alla** migrationer och `supabase/seed.sql` från scratch (databasen
töms först). Kör därefter `node supabase/seed-users-and-data.mjs` igen för att återskapa
testanvändarna, rummen, besiktningen och exempelfilerna.

Stoppa hela den lokala miljön (Docker-containrarna) med:

```bash
npx supabase stop
```

## 8. Växla mellan lokal miljö och produktion

Frontend-koden växlar automatiskt via hostname (se punkt 4) – inget manuellt steg
krävs för att testa mot produktion från en annan miljö, **men gör det med försiktighet**
eftersom det innebär att din webbläsare pratar med den riktiga produktionsdatabasen.

Edge Functions väljer miljö genom vilken `--env-file` du startar dem med:

```bash
# Lokalt (Docker):
npx supabase functions serve --env-file .env.local

# Mot produktion (kräver `supabase link` och rätt behörighet – se säkerhetsavsnittet):
npx supabase functions deploy <funktionsnamn>
```

Produktionens hemligheter sätts **aldrig** via en lokal `.env`-fil, utan via:

```bash
npx supabase secrets set --project-ref <production-project-ref> STRIPE_SECRET_KEY=... RESEND_API_KEY=...
```

`.env.production` i repot innehåller bara icke-känsliga referensvärden (URL och den
redan publika anon-nyckeln) plus platshållare som dokumenterar vilka variabler som
finns – riktiga värden ligger enbart i Supabase/Netlifys egna secret-lagring.

## 9. Säkerhet – checklista

- [ ] `.env.local` är gitignorad (se `.gitignore`) och innehåller aldrig
      produktionsnycklar – bara CLI:ts publika lokala standardnycklar och ev.
      testnycklar för Stripe/Resend.
- [ ] `.env.production` innehåller inga riktiga hemligheter, bara publika värden och
      `__SATT_VIA_SUPABASE_SECRETS__`-platshållare.
- [ ] `supabase/config.toml` är **inte** länkad (`supabase link`) mot
      produktionsprojektet i denna arbetskopia. Kör `supabase link` bara om du
      medvetet ska hantera produktionsmigrationer, och dubbelkolla `supabase status`
      innan du kör `db reset`/`db push` så att du vet vilket projekt CLI:t pratar med.
- [ ] Seed-scriptet (`seed-users-and-data.mjs`) skapar bara `@local.test`-konton med
      testlösenordet `Password123!` – inga riktiga användare importeras någonsin.
- [ ] `purge-expired-brfs` körs bara lokalt med `PURGE_CRON_SECRET=local-dev-secret`,
      aldrig med produktionens hemlighet, för att undvika att radera riktig data av
      misstag.

## 10. Kända begränsningar / manuella steg som kan behövas

- `supabase start` → `db reset` → `seed-users-and-data.mjs` är verifierat end-to-end.
  `functions serve` (Edge Functions) är däremot inte testat mot externa tjänster
  (Stripe/Resend/push) – se punkterna nedan.
- `supabase/config.toml` är handskriven för att motsvara ett vanligt `supabase init`.
  Om `supabase start` klagar på okända fält, kör `supabase --version` och stäm av mot
  https://supabase.com/docs/guides/local-development/cli/config för just din version.
- Push-notiser kräver att du själv genererar ett lokalt VAPID-nyckelpar
  (`supabase/generate-vapid-keys.ps1`) – standardplatshållaren fungerar inte.
- Stripe-flödena (`create-checkout`, `create-portal`, `stripe-webhook`) kräver ett
  eget Stripe-testkonto om du vill testa betalflödet fullt ut; utan nycklar svarar
  funktionerna med ett tydligt felmeddelande istället för att krascha.
