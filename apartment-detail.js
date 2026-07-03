(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  })[character]);

  const resultInfo = result => ({
    approved: { label:'Godkänd', className:'approved', icon:'✓' },
    remark: { label:'Anmärkning', className:'issue', icon:'!' },
    not_accessible: { label:'Ej åtkomlig', className:'issue', icon:'×' },
    not_inspected: { label:'Ej kontrollerad', className:'issue', icon:'–' }
  })[result] || { label:'Ej bedömd', className:'neutral', icon:'–' };

  async function openLiveApartment(apartment) {
    window.procellaApp.openModal(`
      <div class="apartment-detail-loading">
        <span class="loading-spinner"></span>
        <strong>Hämtar lägenhet ${escapeHtml(apartment.no)}…</strong>
      </div>`);

    try {
      const { data: rooms, error: roomsError } = await window.procellaDb
        .from('rooms').select('id,name,room_type,sort_order,notes')
        .eq('apartment_id', apartment.id).order('sort_order');
      if (roomsError) throw roomsError;

      const roomIds = rooms.map(room => room.id);
      const unitsQuery = roomIds.length
        ? window.procellaDb.from('ventilation_units').select('id,room_id,label,unit_type,manufacturer,model,notes').in('room_id', roomIds)
        : Promise.resolve({ data: [], error: null });
      const deviationsQuery = window.procellaDb.from('deviations')
        .select('id,room_id,title,description,status,due_date,created_at')
        .eq('apartment_id', apartment.id).order('created_at', { ascending:false });
      const mediaQuery = window.procellaDb.from('media')
        .select('id,room_id,caption,captured_at,storage_path')
        .eq('apartment_id', apartment.id).order('captured_at', { ascending:false });

      const [{ data: units, error: unitsError }, { data: deviations, error: deviationsError }, { data: media, error: mediaError }] = await Promise.all([
        unitsQuery, deviationsQuery, mediaQuery
      ]);
      if (unitsError) throw unitsError;
      if (deviationsError) throw deviationsError;
      if (mediaError) throw mediaError;

      const unitIds = units.map(unit => unit.id);
      const entriesQuery = unitIds.length
        ? window.procellaDb.from('inspection_entries')
            .select('id,inspection_id,ventilation_unit_id,measured_flow_lps,setting_value,result,comment,inspected_at')
            .in('ventilation_unit_id', unitIds).order('inspected_at', { ascending:false })
        : Promise.resolve({ data: [], error: null });
      const { data: entries, error: entriesError } = await entriesQuery;
      if (entriesError) throw entriesError;

      const inspectionIds = [...new Set(entries.map(entry => entry.inspection_id))];
      const inspectionsQuery = inspectionIds.length
        ? window.procellaDb.from('inspections')
            .select('id,title,inspection_date,status,inspector_company,inspector_name')
            .in('id', inspectionIds)
        : Promise.resolve({ data: [], error: null });
      const { data: inspections, error: inspectionsError } = await inspectionsQuery;
      if (inspectionsError) throw inspectionsError;

      if (media.length) {
        const { data: signedFiles } = await window.procellaDb.storage.from('ventilation-media')
          .createSignedUrls(media.map(item => item.storage_path), 3600);
        media.forEach((item,index) => { item.signedUrl = signedFiles?.[index]?.signedUrl || null; });
      }

      renderApartment(apartment, rooms, units, entries, inspections, deviations, media);
    } catch (error) {
      document.querySelector('#modalContent').innerHTML = `
        <div class="detail-error"><strong>Lägenheten kunde inte hämtas</strong><p>${escapeHtml(error.message)}</p></div>
        <div class="modal-footer"><button class="secondary-button" onclick="closeModal()">Stäng</button></div>`;
    }
  }

  function renderApartment(apartment, rooms, units, entries, inspections, deviations, media) {
    const entriesByUnit = entries.reduce((map, entry) => {
      if (!map[entry.ventilation_unit_id]) map[entry.ventilation_unit_id] = entry;
      return map;
    }, {});
    const inspectionById = Object.fromEntries(inspections.map(inspection => [inspection.id, inspection]));
    const unitsByRoom = units.reduce((map, unit) => ((map[unit.room_id] ||= []).push(unit), map), {});
    const deviationsByRoom = deviations.reduce((map, deviation) => ((map[deviation.room_id] ||= []).push(deviation), map), {});
    const mediaByRoom = media.reduce((map, item) => ((map[item.room_id] ||= []).push(item), map), {});
    const openDeviations = deviations.filter(deviation => !['resolved','dismissed'].includes(deviation.status));
    const approvedUnits = units.filter(unit => entriesByUnit[unit.id]?.result === 'approved').length;
    const latestInspection = inspections.sort((a,b) => String(b.inspection_date).localeCompare(String(a.inspection_date)))[0];

    const roomHtml = rooms.map(room => {
      const roomUnits = unitsByRoom[room.id] || [];
      const roomDeviations = deviationsByRoom[room.id] || [];
      const roomMedia = mediaByRoom[room.id] || [];
      return `
        <article class="detail-room">
          <div class="detail-room-head">
            <div><span class="room-symbol">${room.name.toLowerCase().includes('kök') ? 'K' : room.name.charAt(0).toUpperCase()}</span><strong>${escapeHtml(room.name)}</strong></div>
            <div class="room-photo-actions"><span>${roomMedia.length} bilder</span><button type="button" data-add-room-photo="${room.id}">＋ Bild</button></div>
          </div>
          ${roomMedia.length ? `<div class="room-photo-strip">${roomMedia.map(item=>item.signedUrl?`<a href="${item.signedUrl}" target="_blank" rel="noopener"><img src="${item.signedUrl}" alt="${escapeHtml(item.caption||room.name)}"></a>`:'').join('')}</div>`:''}
          <div class="unit-list">
            ${roomUnits.length ? roomUnits.map(unit => {
              const entry = entriesByUnit[unit.id];
              const result = resultInfo(entry?.result);
              const inspection = entry ? inspectionById[entry.inspection_id] : null;
              return `<div class="unit-row">
                <div class="unit-main"><span class="air-icon">${unit.unit_type === 'extract' ? '↑' : '↓'}</span><div><strong>${escapeHtml(unit.label)}</strong><small>${unit.unit_type === 'extract' ? 'Frånluft' : 'Tilluft'}${inspection ? ` · ${escapeHtml(inspection.title)}` : ''}</small></div></div>
                <div class="flow-value"><strong>${entry?.measured_flow_lps ?? '–'}</strong><small>${entry?.measured_flow_lps != null ? 'l/s' : 'ej uppmätt'}</small></div>
                <span class="pill ${result.className}">${result.icon} ${result.label}</span>
                ${(entry?.comment || unit.notes) ? `<p class="unit-note">${escapeHtml(entry?.comment || unit.notes)}</p>` : ''}
              </div>`;
            }).join('') : '<div class="empty-unit">Ingen ventilationspunkt registrerad i protokollet.</div>'}
          </div>
          ${roomDeviations.length ? `<div class="room-deviations">${roomDeviations.map(deviation => `<p><strong>!</strong> ${escapeHtml(deviation.description || deviation.title)}</p>`).join('')}</div>` : ''}
        </article>`;
    }).join('');

    document.querySelector('#modalContent').innerHTML = `
      <div class="apartment-detail">
        <p class="eyebrow">${escapeHtml(apartment.address.toUpperCase())}</p>
        <div class="detail-title"><div><h2 id="modalTitle">Lägenhet ${escapeHtml(apartment.no)}</h2><p>Importerad från senaste OVK-protokollet</p></div><div class="detail-title-actions"><button class="secondary-button" data-edit-apartment>✎ Redigera</button><span class="pill ${openDeviations.length ? 'issue':'approved'}">${openDeviations.length ? `${openDeviations.length} att granska` : 'Dokumenterad'}</span></div></div>
        <div class="detail-summary">
          <div><span>Rum</span><strong>${rooms.length}</strong></div>
          <div><span>Ventilationspunkter</span><strong>${units.length}</strong></div>
          <div><span>Godkända</span><strong>${approvedUnits}/${units.length}</strong></div>
          <div><span>Senaste kontroll</span><strong>${latestInspection?.inspection_date || '–'}</strong></div>
        </div>
        <div class="detail-section-head"><div><h3>Rum och ventilation</h3><p>Mätresultat från ${escapeHtml(latestInspection?.title || 'OVK-protokollet')}</p></div></div>
        <div class="detail-rooms">${roomHtml || '<div class="empty-data"><strong>Inga rum registrerade</strong></div>'}</div>
        ${openDeviations.length ? `<section class="detail-deviations"><h3>Anmärkningar att följa upp</h3>${openDeviations.map(deviation => `<div><strong>${escapeHtml(deviation.title)}</strong><p>${escapeHtml(deviation.description || 'Ingen ytterligare beskrivning.')}</p></div>`).join('')}</section>` : ''}
        <div class="modal-footer"><button class="secondary-button" onclick="closeModal()">Stäng</button></div>
      </div>`;

    document.querySelector('[data-edit-apartment]')?.addEventListener('click', () => openApartmentEditor(apartment, rooms, units));
    document.querySelectorAll('[data-add-room-photo]').forEach(button => button.addEventListener('click', () => {
      const room = rooms.find(item => item.id === button.dataset.addRoomPhoto);
      chooseAndUploadPhotos(apartment, room);
    }));
  }

  function openApartmentEditor(apartment, rooms, units){
    const unitCountByRoom=units.reduce((map,unit)=>(map[unit.room_id]=(map[unit.room_id]||0)+1,map),{});
    document.querySelector('#modalContent').innerHTML=`
      <p class="eyebrow">${escapeHtml(apartment.address.toUpperCase())}</p>
      <h2 id="modalTitle">Redigera lägenhet ${escapeHtml(apartment.no)}</h2>
      <p class="subtitle">Ändra lägenhetsuppgifter och lägg till eller döp om rum. Importerade mätningar bevaras.</p>
      <form id="apartmentEditForm">
        <div class="form-grid">
          <label>Lägenhetsnummer<input name="apartment_number" required value="${escapeHtml(apartment.no)}"></label>
          <label>Antal rum enligt RoK<input name="rooms_count" type="number" min="0" value="${apartment.roomsCount ?? ''}" placeholder="Ex. 3"></label>
        </div>
        <div class="room-editor-head"><h3>Rum, WC och badrum</h3><button type="button" class="secondary-button" data-add-room-row>＋ Lägg till rum</button></div>
        <div class="room-editor-list" id="roomEditorList">
          ${rooms.map(room=>`<div class="room-editor-row" data-existing-room="${room.id}"><input value="${escapeHtml(room.name)}" aria-label="Rumsnamn"><span>${unitCountByRoom[room.id]||0} ventilationspunkter</span></div>`).join('')}
        </div>
        <p class="editor-note">Rum som innehåller OVK-mätningar kan döpas om men tas inte bort, så historiken förblir intakt.</p>
        <div class="modal-footer"><button type="button" class="secondary-button" data-cancel-edit>Avbryt</button><button class="primary-button" id="saveApartmentEdit">Spara ändringar</button></div>
      </form>`;
    document.querySelector('[data-add-room-row]').addEventListener('click',addRoomEditorRow);
    document.querySelector('[data-cancel-edit]').addEventListener('click',()=>openLiveApartment(apartment));
    document.querySelector('#apartmentEditForm').addEventListener('submit',event=>saveApartmentEdit(event,apartment,rooms));
  }

  function addRoomEditorRow(){
    const row=document.createElement('div'); row.className='room-editor-row new';
    row.innerHTML=`<select aria-label="Typ av rum"><option>Kök</option><option>Vardagsrum</option><option>Sovrum</option><option>Badrum</option><option>WC</option><option>Matrum</option><option>Tvätt</option><option>Övrigt</option></select><button type="button" aria-label="Ta bort">×</button>`;
    row.querySelector('button').addEventListener('click',()=>row.remove());
    document.querySelector('#roomEditorList').append(row);
  }

  async function saveApartmentEdit(event,apartment,originalRooms){
    event.preventDefault(); const submit=document.querySelector('#saveApartmentEdit'); submit.disabled=true; submit.textContent='Sparar…';
    try{
      const form=new FormData(event.target); const number=form.get('apartment_number').trim(); const roomsCount=form.get('rooms_count');
      const {error:apartmentError}=await window.procellaDb.from('apartments').update({apartment_number:number,rooms_count:roomsCount===''?null:Number(roomsCount)}).eq('id',apartment.id);
      if(apartmentError)throw apartmentError;
      for(const row of document.querySelectorAll('[data-existing-room]')){
        const name=row.querySelector('input').value.trim(); const original=originalRooms.find(room=>room.id===row.dataset.existingRoom);
        if(name&&original&&name!==original.name){const {error}=await window.procellaDb.from('rooms').update({name,room_type:name.toLowerCase()}).eq('id',original.id);if(error)throw error;}
      }
      const newRows=[...document.querySelectorAll('.room-editor-row.new select')];
      if(newRows.length){const {error}=await window.procellaDb.from('rooms').insert(newRows.map((select,index)=>({apartment_id:apartment.id,name:select.value,room_type:select.value.toLowerCase(),sort_order:originalRooms.length+index})));if(error)throw error;}
      apartment.no=number; apartment.roomsCount=roomsCount===''?null:Number(roomsCount);
      window.procellaApp.showToast('Lägenheten har uppdaterats'); window.dispatchEvent(new CustomEvent('procella:data-changed')); await openLiveApartment(apartment);
    }catch(error){submit.disabled=false;submit.textContent='Försök igen';showInlineError(submit,error.message);}
  }

  function chooseAndUploadPhotos(apartment,room){
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=true;
    input.addEventListener('change',()=>uploadRoomPhotos(apartment,room,[...input.files]));input.click();
  }

  async function uploadRoomPhotos(apartment,room,files){
    if(!files.length)return; window.procellaApp.showToast(`Laddar upp ${files.length} bild${files.length===1?'':'er'}…`);
    try{
      for(const file of files){
        if(file.size>15*1024*1024)throw new Error(`${file.name} är större än 15 MB.`);
        const extension=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
        const path=`${apartment.brfId}/${apartment.id}/${room.id}/${crypto.randomUUID()}.${extension}`;
        const {error:uploadError}=await window.procellaDb.storage.from('ventilation-media').upload(path,file,{contentType:file.type,upsert:false});
        if(uploadError)throw uploadError;
        const {error:mediaError}=await window.procellaDb.from('media').insert({brf_id:apartment.brfId,apartment_id:apartment.id,room_id:room.id,storage_path:path,media_type:'photo',caption:file.name,captured_at:new Date(file.lastModified||Date.now()).toISOString()});
        if(mediaError)throw mediaError;
      }
      window.procellaApp.showToast('Bilderna är sparade'); await openLiveApartment(apartment);
    }catch(error){window.procellaApp.showToast(`Bilduppladdning misslyckades: ${error.message}`);}
  }

  function showInlineError(button,message){document.querySelector('.modal .auth-message.error')?.remove();const p=document.createElement('p');p.className='auth-message error';p.textContent=message;button.closest('.modal-footer').before(p);}

  window.openLiveApartment = openLiveApartment;
})();
