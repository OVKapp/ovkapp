// Procella OVK – lokal seed: auth-användare, exempeldata och exempelfiler i Storage.
//
// Körs manuellt EFTER `supabase start` (eller `supabase db reset`), eftersom
// supabase/seed.sql inte kan skapa auth-användare på ett versionssäkert sätt
// (GoTrues interna tabeller varierar mellan CLI-versioner). Det här scriptet
// använder istället den officiella Admin API:t (/auth/v1/admin/users) och
// PostgREST (/rest/v1/...) med service_role-nyckeln, precis som Supabase
// rekommenderar för programmatisk seedning.
//
// Körning:  node supabase/seed-users-and-data.mjs
// Krav:     Node.js 18+ (för inbyggd fetch). Inga npm-paket behövs.
//
// Scriptet är säkert att köra flera gånger: redan skapade användare/rader
// hoppas över istället för att dupliceras.

import { readFileSync, existsSync } from 'node:fs';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    values[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }
  return values;
}

const fileEnv = loadEnvFile(new URL('../.env.local', import.meta.url));
const env = key => process.env[key] || fileEnv[key];

const SUPABASE_URL = env('SUPABASE_URL') || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY saknas. Kontrollera .env.local eller kör `supabase status` för att hämta nyckeln.');
  process.exit(1);
}

const BRF_ID = '11111111-1111-1111-1111-111111111111';
const APARTMENTS = {
  'A-1101': '33333333-3333-3333-3333-333333333331',
  'A-1102': '33333333-3333-3333-3333-333333333332',
  'B-1201': '33333333-3333-3333-3333-333333333333'
};

const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

async function restGet(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: adminHeaders });
  if (!response.ok) throw new Error(`GET ${table}: ${await response.text()}`);
  return response.json();
}

async function restInsert(table, rows) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...adminHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`POST ${table}: ${await response.text()}`);
  return response.json();
}


async function findUserByEmail(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: adminHeaders });
  if (!response.ok) throw new Error(`Listning av användare misslyckades: ${await response.text()}`);
  const { users } = await response.json();
  return users.find(user => user.email?.toLowerCase() === email.toLowerCase());
}

async function ensureUser(email, fullName) {
  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`Konto finns redan: ${email}`);
    return existing;
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { full_name: fullName }
    })
  });
  if (!response.ok) throw new Error(`Kunde inte skapa ${email}: ${await response.text()}`);
  const created = await response.json();
  console.log(`Skapade konto: ${email} (lösenord: Password123!)`);
  return created;
}

async function ensureRoomsAndUnits(apartmentId, roomNames) {
  const existingRooms = await restGet('rooms', `apartment_id=eq.${apartmentId}&select=id,name`);
  if (existingRooms.length) return existingRooms;
  const rooms = await restInsert('rooms', roomNames.map((name, index) => ({
    apartment_id: apartmentId,
    name,
    room_type: name.toLowerCase(),
    sort_order: index
  })));
  for (const room of rooms) {
    await restInsert('ventilation_units', [
      { room_id: room.id, label: `${room.name} frånluft`, unit_type: 'extract', expected_flow_lps: 12 },
      { room_id: room.id, label: `${room.name} tilluft`, unit_type: 'supply', expected_flow_lps: 10 }
    ]);
  }
  return rooms;
}

async function ensureInspection(inspectedBy) {
  const existing = await restGet('inspections', `brf_id=eq.${BRF_ID}&select=id&limit=1`);
  if (existing.length) return existing[0].id;
  const [inspection] = await restInsert('inspections', [{
    brf_id: BRF_ID,
    title: 'OVK 2024 – lokal exempeldata',
    inspection_date: '2024-03-14',
    next_due_date: '2027-03-14',
    status: 'approved',
    inspector_company: 'Procella Ventilation AB',
    created_by: inspectedBy
  }]);
  return inspection.id;
}

async function seedInspectionEntriesAndDeviations(inspectionId, apartmentId) {
  const rooms = await restGet('rooms', `apartment_id=eq.${apartmentId}&select=id,name`);
  if (!rooms.length) return;
  const units = await restGet('ventilation_units', `room_id=in.(${rooms.map(room => room.id).join(',')})&select=id,room_id,unit_type`);
  const existingEntries = await restGet('inspection_entries', `inspection_id=eq.${inspectionId}&ventilation_unit_id=in.(${units.map(unit => unit.id).join(',')})&select=id&limit=1`);
  if (existingEntries.length) return;

  await restInsert('inspection_entries', units.map((unit, index) => ({
    inspection_id: inspectionId,
    ventilation_unit_id: unit.id,
    measured_flow_lps: unit.unit_type === 'extract' ? 11.5 : 9.8,
    result: index === 0 ? 'remark' : 'approved',
    comment: index === 0 ? 'Flödet är något lågt, bör kontrolleras igen.' : null,
    inspected_at: '2024-03-14T10:00:00+01:00'
  })));

  const firstUnit = units[0];
  if (firstUnit) {
    await restInsert('deviations', [{
      brf_id: BRF_ID,
      apartment_id: apartmentId,
      room_id: firstUnit.room_id,
      inspection_id: inspectionId,
      title: 'Lågt uppmätt flöde',
      description: 'Exempel-avvikelse skapad av lokal seed-data.',
      status: 'needs_review'
    }]);
  }
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function uploadIfMissing(bucket, path, body, contentType) {
  const existing = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { headers: adminHeaders });
  if (existing.ok) return false;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': contentType },
    body
  });
  if (!response.ok) throw new Error(`Uppladdning av ${bucket}/${path} misslyckades: ${await response.text()}`);
  return true;
}

async function seedMediaAndDocuments(apartmentId, inspectionId) {
  const rooms = await restGet('rooms', `apartment_id=eq.${apartmentId}&select=id&limit=1`);
  const roomId = rooms[0]?.id || null;

  const photoPath = `${BRF_ID}/${apartmentId}/${roomId || 'okand-rum'}/exempel.png`;
  const uploadedPhoto = await uploadIfMissing('ventilation-media', photoPath, Buffer.from(TINY_PNG_BASE64, 'base64'), 'image/png');
  if (uploadedPhoto) {
    await restInsert('media', [{
      brf_id: BRF_ID,
      apartment_id: apartmentId,
      room_id: roomId,
      inspection_id: inspectionId,
      storage_path: photoPath,
      media_type: 'photo',
      caption: 'Exempelbild (lokal seed)',
      captured_at: new Date().toISOString()
    }]);
    console.log(`Laddade upp exempelbild: ${photoPath}`);
  }

  const documentPath = `${BRF_ID}/${inspectionId}/exempel-protokoll.txt`;
  const uploadedDocument = await uploadIfMissing('ovk-documents', documentPath, Buffer.from('Exempel-OVK-protokoll för lokal utveckling.\nInnehåller ingen riktig besiktningsdata.', 'utf8'), 'text/plain');
  if (uploadedDocument) {
    await restInsert('documents', [{
      brf_id: BRF_ID,
      inspection_id: inspectionId,
      title: 'Exempel-OVK-protokoll (seed)',
      document_type: 'OVK-underlag (text, seed-exempel)',
      storage_path: documentPath
    }]);
    console.log(`Laddade upp exempeldokument: ${documentPath}`);
  }
}

async function main() {
  console.log(`Seedar mot ${SUPABASE_URL} ...`);

  const admin = await ensureUser('admin@local.test', 'Procella Admin');
  await ensureUser('support@local.test', 'Procella Support');
  await ensureUser('board@local.test', 'Styrelse Testsson');
  await ensureUser('resident@local.test', 'Boende Testsson');

  await ensureRoomsAndUnits(APARTMENTS['A-1101'], ['Kök', 'Badrum', 'Sovrum']);
  await ensureRoomsAndUnits(APARTMENTS['A-1102'], ['Kök', 'Badrum']);
  await ensureRoomsAndUnits(APARTMENTS['B-1201'], ['Kök', 'Badrum', 'Sovrum', 'Vardagsrum']);

  const inspectionId = await ensureInspection(admin.id);
  for (const apartmentId of Object.values(APARTMENTS)) {
    await seedInspectionEntriesAndDeviations(inspectionId, apartmentId);
  }
  await seedMediaAndDocuments(APARTMENTS['A-1101'], inspectionId);

  console.log('\nKlart! Testkonton (lösenord för alla: Password123!):');
  console.log('  admin@local.test     – Procella-administratör (procella_admin)');
  console.log('  support@local.test   – Procella-support (procella_staff)');
  console.log('  board@local.test     – Styrelse (BRF Lokal Utveckling)');
  console.log('  resident@local.test  – Boende (lägenhet A-1101)');
}

main().catch(error => {
  console.error('Seed misslyckades:', error.message);
  process.exit(1);
});
