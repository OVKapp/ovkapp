(() => {
  const button = document.querySelector('#importOvk');
  if (!button) return;

  const ROOM_WORDS = [
    'Kök', 'Badrum', 'WC', 'Dusch', 'Vardagsrum', 'Sovrum', 'Hall',
    'Klädkammare', 'Förråd', 'Tvättstuga', 'Kokvrå'
  ];
  const REMARK_WORDS = [
    'anmärkning', 'anm', 'ej godk', 'underkänd', 'brist', 'åtgärd', 'saknas',
    'otillgäng', 'ej åtkomst', 'ej tillträde', 'block', 'igensatt', 'smuts',
    'lågt', 'för låg', 'högt', 'för hög', 'rens', 'fel', 'trasig'
  ];

  let latestAnalysis = null;
  let latestFile = null;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function plusYears(years) {
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    return date.toISOString().slice(0, 10);
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function getActiveBrf() {
    const brf = window.procellaBrfManager?.getActive?.() || window.procellaCurrentBrf;
    if (!brf) throw new Error('Välj eller lägg till en BRF innan du importerar OVK.');
    const { data: properties, error } = await window.procellaDb
      .from('properties')
      .select('id,street_address,city,stairwells')
      .eq('brf_id', brf.id)
      .order('street_address');
    if (error) throw error;
    if (!properties?.length) throw new Error('Den valda BRF:en behöver minst en fastighet/adress innan import.');
    return { brf, properties };
  }

  function showImportDialog() {
    const brf = window.procellaBrfManager?.getActive?.() || window.procellaCurrentBrf;
    window.procellaApp.openModal(`
      <p class="eyebrow">NY OVK-IMPORT</p>
      <h2 id="modalTitle">Importera OVK-protokoll</h2>
      <p class="subtitle">Ladda upp PDF, TXT eller CSV. Appen försöker hitta lägenheter, rum och anmärkningar. Du får granska allt innan något sparas.</p>
      <form id="ovkAnalyzeForm" class="ovk-import-form">
        <div class="import-selected-brf">
          <span>Vald BRF</span>
          <strong>${escapeHtml(brf?.name || 'Ingen BRF vald')}</strong>
          <button type="button" class="secondary-button small-button" data-open-brf-picker>Byt BRF</button>
        </div>
        <div class="form-grid">
          <label class="full">OVK-protokoll
            <input name="file" id="ovkFile" type="file" accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf">
          </label>
          <div class="full">
            <button type="button" class="secondary-button ovk-camera-button" data-start-camera-import>📷 Ta bild</button>
          </div>
          <label>Besiktningsdatum<input name="inspection_date" type="date" value="${today()}"></label>
          <label>Nästa OVK<input name="next_due_date" type="date" value="${plusYears(3)}"></label>
          <label class="full">Besiktningsföretag<input name="inspector_company" value="Procella Ventilation AB"></label>
        </div>
        <details class="manual-import-help">
          <summary>Om PDF:en inte går att läsa</summary>
          <p>Klistra in en tabell här. En rad per lägenhet/rum fungerar bra:</p>
          <code>Lägenhet;Adress;Rum;Anmärkning;Flöde</code>
          <textarea name="manual_text" rows="6" placeholder="1101;Karlbergsvägen 70 A;Kök;Frånluftsdon saknas;0"></textarea>
        </details>
        <div class="modal-footer">
          <button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button>
          <button class="primary-button" id="ovkAnalyzeSubmit">Analysera protokoll</button>
        </div>
      </form>
    `);
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  function openImportWithCapturedFile(file) {
    showImportDialog();
    const fileInput = document.querySelector('#ovkFile');
    if (!fileInput) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    const form = document.querySelector('#ovkAnalyzeForm');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function showCameraUnsupported(message) {
    window.procellaApp.showToast(message || 'Ingen kamera kunde hittas. Välj en bild eller fil manuellt.');
    showImportDialog();
  }

  function triggerNativeCameraInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (file) openImportWithCapturedFile(file);
    });
    input.click();
  }

  function showCameraCapture(stream) {
    const stopStream = () => stream.getTracks().forEach(track => track.stop());
    window.procellaApp.openModal(`
      <p class="eyebrow">KAMERA</p>
      <h2 id="modalTitle">Ta bild på OVK-protokoll</h2>
      <p class="subtitle">Rikta kameran mot protokollet och ta en bild.</p>
      <div class="camera-preview"><video id="cameraVideo" autoplay playsinline muted></video></div>
      <div class="modal-footer">
        <button type="button" class="secondary-button" id="cameraCancel">Avbryt</button>
        <button class="primary-button" id="cameraShoot">📷 Ta foto</button>
      </div>
    `);
    const video = document.querySelector('#cameraVideo');
    video.srcObject = stream;
    document.querySelector('#cameraCancel').addEventListener('click', () => {
      stopStream();
      window.procellaApp.closeModal();
    });
    document.querySelector('#cameraShoot').addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob(blob => {
        stopStream();
        if (!blob) { showCameraUnsupported('Bilden kunde inte skapas. Försök igen eller välj en fil manuellt.'); return; }
        const file = new File([blob], `ovk-kamera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        openImportWithCapturedFile(file);
      }, 'image/jpeg', 0.92);
    });
  }

  function startCameraImport() {
    if (isMobileDevice()) {
      triggerNativeCameraInput();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showCameraUnsupported('Den här webbläsaren stöder inte kameraåtkomst. Välj en bild eller fil manuellt.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(showCameraCapture)
      .catch(() => showCameraUnsupported('Kameran kunde inte startas. Kontrollera behörigheter eller välj en fil manuellt.'));
  }

  async function readFileText(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf' || file.type === 'application/pdf') {
      if (!window.pdfjsLib) {
        throw new Error('PDF-läsaren kunde inte laddas. Prova att uppdatera sidan eller klistra in protokollet som text.');
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const lines = [];
        let previousY = null;
        for (const item of content.items) {
          const y = Math.round(item.transform?.[5] || 0);
          if (previousY !== null && Math.abs(previousY - y) > 4) lines.push('\n');
          lines.push(item.str);
          previousY = y;
        }
        pages.push(lines.join(' '));
      }
      return normalizeText(pages.join('\n\n'));
    }
    if (/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      return normalizeText(await runOcr(file));
    }
    return normalizeText(await file.text());
  }

  async function runOcr(file) {
    if (!window.Tesseract) {
      throw new Error('OCR-motorn kunde inte laddas. Prova att uppdatera sidan eller välj en fil manuellt.');
    }
    try {
      const { data } = await window.Tesseract.recognize(file, 'swe');
      return data.text;
    } catch (error) {
      throw new Error('Bilden kunde inte tolkas automatiskt (OCR misslyckades). Prova att ta en tydligare bild eller välj en fil manuellt.');
    }
  }

  function parseDelimited(text, properties) {
    const rows = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const parsed = [];
    for (const row of rows) {
      const cells = row.split(/[;\t,]/).map(cell => cell.trim());
      if (cells.length < 2) continue;
      const [apartmentNumber, addressInput, roomInput, remarkInput, flowInput] = cells;
      if (!looksLikeApartment(apartmentNumber)) continue;
      const address = matchAddress(addressInput, properties) || properties[0].street_address;
      const roomName = roomInput || 'OVK-punkt';
      const remark = remarkInput || '';
      parsed.push({
        number: cleanApartmentNumber(apartmentNumber),
        address,
        rooms: [{
          name: normalizeRoomName(roomName),
          units: [{
            label: 'Ventilationspunkt',
            type: guessUnitType(roomName),
            measured_flow_lps: numberFromText(flowInput),
            result: remark ? 'remark' : 'approved',
            notes: remark
          }]
        }]
      });
    }
    return mergeApartments(parsed);
  }

  function parseProtocolText(text, properties) {
    const delimited = parseDelimited(text, properties);
    if (delimited.length >= 3) return delimited;

    const compact = normalizeText(text);
    const marker = /(?:\b(?:lgh|lg|lägenhet|lägenhetsnr|objekt)\b\.?\s*[:#-]?\s*)([A-ZÅÄÖ]?\s?-?\s?\d{3,4}[A-Z]?)/gi;
    const matches = [...compact.matchAll(marker)];
    const chunks = [];

    if (matches.length) {
      matches.forEach((match, index) => {
        const start = match.index;
        const end = matches[index + 1]?.index ?? compact.length;
        chunks.push({
          number: cleanApartmentNumber(match[1]),
          text: compact.slice(start, end)
        });
      });
    } else {
      const fallback = [...compact.matchAll(/\b([A-ZÅÄÖ]-?\d{3,4}|\d{4})\b/g)];
      fallback.slice(0, 500).forEach((match, index) => {
        const start = Math.max(0, match.index - 120);
        const end = fallback[index + 1] ? Math.min(compact.length, fallback[index + 1].index + 120) : Math.min(compact.length, match.index + 500);
        chunks.push({ number: cleanApartmentNumber(match[1]), text: compact.slice(start, end) });
      });
    }

    const parsed = [];
    const seen = new Set();
    for (const chunk of chunks) {
      if (!looksLikeApartment(chunk.number) || seen.has(chunk.number)) continue;
      seen.add(chunk.number);
      const address = matchAddress(chunk.text, properties) || properties[0].street_address;
      const rooms = extractRooms(chunk.text);
      const remarks = extractRemarks(chunk.text);
      parsed.push({
        number: chunk.number,
        address,
        rooms: (rooms.length ? rooms : ['OVK-punkt']).map((roomName, index) => {
          const remark = remarks.find(item => item.toLowerCase().includes(roomName.toLowerCase())) || remarks[index] || '';
          return {
            name: roomName,
            units: [{
              label: roomName === 'OVK-punkt' ? 'Ventilationspunkt' : `${roomName} ventilationspunkt`,
              type: guessUnitType(roomName),
              measured_flow_lps: numberFromText(chunk.text),
              result: remark ? 'remark' : 'approved',
              notes: remark
            }]
          };
        })
      });
    }
    return mergeApartments(parsed);
  }

  function looksLikeApartment(value = '') {
    return /^[A-ZÅÄÖ]?-?\d{3,4}[A-Z]?$/i.test(cleanApartmentNumber(value));
  }

  function cleanApartmentNumber(value = '') {
    return String(value).toUpperCase().replace(/\s+/g, '').replace(/^LGH[:#-]?/i, '').replace(/^LÄGENHET[:#-]?/i, '');
  }

  function matchAddress(text, properties) {
    const haystack = normalizeLoose(text);
    return properties.find(property => {
      const address = normalizeLoose(property.street_address);
      const firstPart = address.split(/[,-]/)[0].trim();
      return haystack.includes(address) || (firstPart.length > 5 && haystack.includes(firstPart));
    })?.street_address;
  }

  function normalizeLoose(value = '') {
    return String(value).toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim();
  }

  function normalizeRoomName(value = '') {
    const found = ROOM_WORDS.find(room => normalizeLoose(value).includes(normalizeLoose(room)));
    return found || String(value || 'OVK-punkt').trim();
  }

  function extractRooms(text) {
    const loose = normalizeLoose(text);
    return ROOM_WORDS.filter(room => loose.includes(normalizeLoose(room)));
  }

  function extractRemarks(text) {
    const lines = normalizeText(text).split(/(?:\n|\. |\s{2,})/).map(line => line.trim()).filter(Boolean);
    return lines
      .filter(line => REMARK_WORDS.some(word => line.toLowerCase().includes(word)))
      .map(line => line.slice(0, 220))
      .slice(0, 8);
  }

  function guessUnitType(roomName) {
    const room = roomName.toLowerCase();
    if (/(kök|badrum|wc|dusch|tvätt)/.test(room)) return 'extract';
    if (/(sovrum|vardagsrum)/.test(room)) return 'supply';
    return 'other';
  }

  function numberFromText(text = '') {
    const match = String(text).match(/(-?\d+(?:[,.]\d+)?)\s*(?:l\/s|lps|liter)/i);
    return match ? Number(match[1].replace(',', '.')) : null;
  }

  function mergeApartments(rows) {
    const byKey = new Map();
    for (const row of rows) {
      const key = `${row.address}::${row.number}`;
      if (!byKey.has(key)) byKey.set(key, { ...row, rooms: [] });
      const target = byKey.get(key);
      for (const room of row.rooms) {
        const existing = target.rooms.find(item => item.name.toLowerCase() === room.name.toLowerCase());
        if (existing) existing.units.push(...room.units);
        else target.rooms.push(room);
      }
    }
    return [...byKey.values()].sort((a, b) => a.address.localeCompare(b.address, 'sv') || a.number.localeCompare(b.number, 'sv'));
  }

  function countAnalysis(apartments) {
    return {
      apartments: apartments.length,
      rooms: apartments.reduce((sum, apartment) => sum + apartment.rooms.length, 0),
      units: apartments.reduce((sum, apartment) => sum + apartment.rooms.reduce((roomSum, room) => roomSum + room.units.length, 0), 0),
      remarks: apartments.reduce((sum, apartment) => sum + apartment.rooms.reduce((roomSum, room) => roomSum + room.units.filter(unit => unit.result !== 'approved').length, 0), 0)
    };
  }

  function showReview(analysis) {
    const totals = countAnalysis(analysis.apartments);
    const addressCounts = Object.entries(analysis.apartments.reduce((result, apartment) => {
      result[apartment.address] = (result[apartment.address] || 0) + 1;
      return result;
    }, {}));
    const preview = analysis.apartments.slice(0, 80);
    window.procellaApp.openModal(`
      <p class="eyebrow">GRANSKA IMPORT</p>
      <h2 id="modalTitle">Kontrollera vad appen hittade</h2>
      <p class="subtitle">Källa: <strong>${escapeHtml(analysis.fileName)}</strong>. Kontrollera särskilt rader med anmärkning innan du sparar.</p>
      <div class="import-kpis">
        <div><strong>${totals.apartments}</strong><span>Lägenheter</span></div>
        <div><strong>${totals.rooms}</strong><span>Rum</span></div>
        <div><strong>${totals.units}</strong><span>Ventilationspunkter</span></div>
        <div><strong>${totals.remarks}</strong><span>Anmärkningar</span></div>
      </div>
      <div class="address-preview">
        ${addressCounts.map(([address, count]) => `<div><span>${escapeHtml(address)}</span><strong>${count} lgh</strong></div>`).join('') || '<div><span>Ingen adress hittad</span><strong>0</strong></div>'}
      </div>
      ${totals.apartments ? '' : '<div class="import-warning"><strong>Inga lägenheter hittades automatiskt</strong><p>Gå tillbaka och klistra in protokollet som text eller CSV-format.</p></div>'}
      <div class="ovk-preview-list">
        ${preview.map(apartment => {
          const remarks = apartment.rooms.flatMap(room => room.units.filter(unit => unit.result !== 'approved').map(unit => unit.notes)).filter(Boolean);
          return `<div class="ovk-preview-row">
            <strong>${escapeHtml(apartment.number)}</strong>
            <span>${escapeHtml(apartment.address)}</span>
            <small>${apartment.rooms.length} rum · ${apartment.rooms.reduce((sum, room) => sum + room.units.length, 0)} punkter</small>
            ${remarks.length ? `<p>${escapeHtml(remarks[0])}</p>` : ''}
          </div>`;
        }).join('') || '<p class="empty-data">Ingen förhandsvisning.</p>'}
      </div>
      <form id="ovkImportForm">
        <label class="import-confirm"><input type="checkbox" required> Jag har granskat sammanställningen och vill spara detta på vald BRF.</label>
        <div class="modal-footer">
          <button type="button" class="secondary-button" data-back-to-import>Gå tillbaka</button>
          <button class="primary-button" id="ovkImportSubmit" ${totals.apartments ? '' : 'disabled'}>Spara OVK-import</button>
        </div>
      </form>
    `);
  }

  async function analyzeForm(form) {
    const submit = document.querySelector('#ovkAnalyzeSubmit');
    submit.disabled = true;
    submit.textContent = 'Läser protokoll…';
    try {
      const { brf, properties } = await getActiveBrf();
      const file = form.file.files[0];
      const manualText = form.manual_text.value.trim();
      if (!file && !manualText) throw new Error('Välj en fil eller klistra in protokollet som text.');
      latestFile = file || null;
      const fileText = manualText || await readFileText(file);
      submit.textContent = 'Tolkar lägenheter…';
      const apartments = parseProtocolText(fileText, properties);
      latestAnalysis = {
        brf,
        properties,
        apartments,
        rawText: fileText,
        fileName: file?.name || 'Inklistrad text',
        inspectionDate: form.inspection_date.value || today(),
        nextDueDate: form.next_due_date.value || null,
        inspectorCompany: form.inspector_company.value || 'Procella Ventilation AB'
      };
      showReview(latestAnalysis);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Försök igen';
      showFormError(submit, error.message || 'Protokollet kunde inte analyseras.');
    }
  }

  function showFormError(button, message) {
    document.querySelector('.modal .auth-message.error')?.remove();
    const element = document.createElement('p');
    element.className = 'auth-message error';
    element.textContent = message;
    button.closest('.modal-footer').before(element);
  }

  async function insertAndReturn(table, payload) {
    const { data, error } = await window.procellaDb.from(table).insert(payload).select().single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  }

  async function ensureApartment(propertyId, apartment) {
    const { data: existing, error } = await window.procellaDb
      .from('apartments')
      .select('id,apartment_number')
      .eq('property_id', propertyId)
      .eq('apartment_number', apartment.number)
      .maybeSingle();
    if (error) throw error;
    if (existing) {
      await window.procellaDb.from('apartments').update({ rooms_count: apartment.rooms.length || null }).eq('id', existing.id);
      return existing;
    }
    return insertAndReturn('apartments', {
      property_id: propertyId,
      apartment_number: apartment.number,
      rooms_count: apartment.rooms.length || null,
      notes: `Skapad från OVK-import ${latestAnalysis.inspectionDate}.`
    });
  }

  async function ensureRoom(apartmentId, room, sortOrder) {
    const { data: existing, error } = await window.procellaDb
      .from('rooms')
      .select('id,name')
      .eq('apartment_id', apartmentId)
      .ilike('name', room.name)
      .maybeSingle();
    if (error) throw error;
    if (existing) return existing;
    return insertAndReturn('rooms', {
      apartment_id: apartmentId,
      name: room.name,
      room_type: room.name.toLowerCase(),
      sort_order: sortOrder
    });
  }

  async function ensureUnit(roomId, unit) {
    const { data: existing, error } = await window.procellaDb
      .from('ventilation_units')
      .select('id,label')
      .eq('room_id', roomId)
      .ilike('label', unit.label)
      .maybeSingle();
    if (error) throw error;
    if (existing) return existing;
    return insertAndReturn('ventilation_units', {
      room_id: roomId,
      label: unit.label,
      unit_type: unit.type || 'other',
      expected_flow_lps: null,
      notes: unit.notes || null
    });
  }

  async function saveDocument(inspectionId) {
    if (!latestFile) return null;
    const extension = latestFile.name.split('.').pop() || 'pdf';
    const safeName = latestFile.name.replace(/[^\wåäöÅÄÖ.-]+/g, '-');
    const path = `${latestAnalysis.brf.id}/${inspectionId}/${Date.now()}-${safeName}`;
    const upload = await window.procellaDb.storage.from('ovk-documents').upload(path, latestFile, { upsert: false });
    if (upload.error) throw new Error(`Dokumentuppladdning: ${upload.error.message}`);
    return insertAndReturn('documents', {
      brf_id: latestAnalysis.brf.id,
      inspection_id: inspectionId,
      title: latestFile.name,
      document_type: extension.toLowerCase() === 'pdf' ? 'OVK-protokoll PDF' : 'OVK-underlag',
      storage_path: path
    });
  }

  async function runImport() {
    const submit = document.querySelector('#ovkImportSubmit');
    submit.disabled = true;
    const progress = label => { submit.textContent = label; };
    try {
      if (!latestAnalysis?.apartments?.length) throw new Error('Det finns ingen granskad import att spara.');
      progress('Skapar besiktning…');
      const inspection = await insertAndReturn('inspections', {
        brf_id: latestAnalysis.brf.id,
        title: `OVK ${latestAnalysis.inspectionDate}`,
        inspection_date: latestAnalysis.inspectionDate,
        next_due_date: latestAnalysis.nextDueDate,
        status: countAnalysis(latestAnalysis.apartments).remarks ? 'remarks' : 'approved',
        inspector_company: latestAnalysis.inspectorCompany,
        summary: `Importerad från ${latestAnalysis.fileName}. Lägenheter/rum/anmärkningar granskades innan import.`
      });

      try {
        progress('Sparar originalprotokoll…');
        await saveDocument(inspection.id);
      } catch (documentError) {
        console.warn(documentError);
      }

      const propertyByAddress = Object.fromEntries(latestAnalysis.properties.map(property => [property.street_address, property.id]));
      let savedApartments = 0;
      let savedRemarks = 0;
      for (const apartment of latestAnalysis.apartments) {
        progress(`Sparar lägenhet ${apartment.number}…`);
        const propertyId = propertyByAddress[apartment.address] || latestAnalysis.properties[0].id;
        const savedApartment = await ensureApartment(propertyId, apartment);
        savedApartments += 1;
        for (let roomIndex = 0; roomIndex < apartment.rooms.length; roomIndex += 1) {
          const room = apartment.rooms[roomIndex];
          const savedRoom = await ensureRoom(savedApartment.id, room, roomIndex);
          for (const unit of room.units) {
            const savedUnit = await ensureUnit(savedRoom.id, unit);
            const { error: entryError } = await window.procellaDb.from('inspection_entries').upsert({
              inspection_id: inspection.id,
              ventilation_unit_id: savedUnit.id,
              measured_flow_lps: unit.measured_flow_lps,
              result: unit.result || 'approved',
              comment: unit.notes || null,
              inspected_at: `${latestAnalysis.inspectionDate}T12:00:00+01:00`
            }, { onConflict: 'inspection_id,ventilation_unit_id' });
            if (entryError) throw new Error(`Mätpunkt: ${entryError.message}`);
            if (unit.result !== 'approved') {
              const { error: deviationError } = await window.procellaDb.from('deviations').insert({
                brf_id: latestAnalysis.brf.id,
                apartment_id: savedApartment.id,
                room_id: savedRoom.id,
                inspection_id: inspection.id,
                title: 'OVK-anmärkning',
                description: unit.notes || `${room.name}: behöver granskas enligt OVK-protokollet.`,
                status: 'needs_review'
              });
              if (deviationError) throw new Error(`Anmärkning: ${deviationError.message}`);
              savedRemarks += 1;
            }
          }
        }
      }

      window.procellaApp.closeModal();
      window.procellaApp.showToast(`Import klar: ${savedApartments} lägenheter, ${savedRemarks} anmärkningar`);
      window.dispatchEvent(new CustomEvent('procella:data-changed'));
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Försök igen';
      showFormError(submit, error.message || 'Importen misslyckades.');
      console.error(error);
    }
  }

  button.addEventListener('click', showImportDialog);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-brf-picker]')) {
      window.procellaApp.closeModal();
      window.procellaBrfManager?.showSelector?.();
    }
    if (event.target.closest('[data-back-to-import]')) showImportDialog();
    if (event.target.closest('[data-start-camera-import]')) startCameraImport();
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'ovkAnalyzeForm') {
      event.preventDefault();
      analyzeForm(event.target);
    }
    if (event.target.id === 'ovkImportForm') {
      event.preventDefault();
      runImport();
    }
  });
})();
