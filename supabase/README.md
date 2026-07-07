# Supabase – mappstruktur

Den här mappen följer Supabase CLI:s standardstruktur så att hela databasschemat kan
byggas upp lokalt med Docker (`supabase start` / `supabase db reset`).

```
supabase/
  config.toml            Lokal CLI-konfiguration (Docker-portar, Auth, Storage m.m.)
  migrations/             Schemat, i den ordning det ska appliceras
  seed.sql                Grunddata som körs automatiskt efter migrationerna
  seed-users-and-data.mjs Skapar auth-användare + exempeldata/bilder (körs manuellt, se DEVELOPING.md)
  functions/              Edge Functions (oförändrade, ingen logik har ändrats)
  generate-vapid-keys.ps1 Oförändrad – genererar VAPID-nycklar för push
```

## Migrationsordning och varför

De ursprungliga fristående SQL-filerna (tidigare i `supabase/*.sql`, körda manuellt i
Supabase SQL Editor) har flyttats **oförändrade** till `supabase/migrations/` med
tidsstämplade filnamn, i den ordning som redan krävdes av deras egna kommentarer
("Kör efter X.sql"):

| Ny migration | Ursprunglig fil | Anledning till placeringen |
|---|---|---|
| `20240101000000_initial_schema.sql` | `setup.sql` | Grundschema, roller, RLS-grund |
| `20240102000000_users_and_invitations.sql` | `users-and-invitations.sql` | Inbjudningar, kräver grundschemat |
| `20240103000000_invitation_email_status.sql` | `invitation-email.sql` | Lägger kolumner på `access_invitations` |
| `20240104000000_secure_invite_signup.sql` | `secure-invite-signup.sql` | Måste köras efter `users-and-invitations` |
| `20240105000000_fix_rls_recursion.sql` | `fix-rls-recursion.sql` | Rättar policies från grundschemat, **måste** ligga före `subscriptions` (se nedan) |
| `20240106000000_messaging.sql` | `messaging.sql` | Meddelandecentral |
| `20240107000000_notifications.sql` | `notifications.sql` | Kräver `messaging.sql` (egen kommentar i filen) |
| `20240108000000_subscriptions.sql` | `subscriptions.sql` | Skriver om `can_access_*`-funktionerna igen (måste komma efter `fix-rls-recursion`, annars skrivs abonnemangsspärren över) |
| `20240109000000_retention_and_autogiro.sql` | `retention-and-autogiro.sql` | Kräver `subscriptions.sql` (egen kommentar) |
| `20240110000000_invoice_payment.sql` | `invoice-payment.sql` | Kräver `subscriptions.sql` + `retention-and-autogiro.sql` (egen kommentar) |

**Ingen SQL-logik har ändrats.** Filerna är byte-för-byte identiska med originalen,
bara flyttade och omdöpta.

## Viktigt om produktionsdatabasen

Denna mapp är **inte** kopplad (`supabase link`) till något Supabase-projekt. Att köra
`supabase start`, `supabase db reset` eller `supabase migration up` utan `--linked`
påverkar **endast** den lokala Docker-databasen. Länka aldrig detta repo mot
produktionsprojektet utan att först stämma av med teamet – se säkerhetsavsnittet i
`DEVELOPING.md`.
