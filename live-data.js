(() => {
  let availableBrfs = [];
  let activeBrfId = localStorage.getItem('procella_active_brf');
  const pilot = Object.freeze({
    name: 'BRF Nya Skålen 20',
    propertyDesignation: 'Stockholm Skålen 20',
    city: 'Stockholm',
    apartmentCount: 131,
    rentalCount: 19,
    boardEmail: 'brf.nya.skalen20@gmail.com',
    source: 'https://nyaskalen20.wordpress.com/om-fastighet-och-forening/',
    properties: [
      { street_address: 'Karlbergsvägen 70 A-B', city: 'Stockholm', stairwells: 2 },
      { street_address: 'Norrbackagatan 21-25', city: 'Stockholm', stairwells: 3 }
    ]
  });

  function resetExampleContent(){
    const app = window.procellaApp;
    app.buildings.splice(0, app.buildings.length);
    app.apartments.splice(0, app.apartments.length);
    app.renderBuildings();
    app.renderApartments();
    document.querySelector('.alert-banner').hidden = true;
    document.querySelector('.nav-badge').hidden = true;
    document.querySelector('.timeline').innerHTML = '<div class="empty-data"><strong>Ingen aktivitet ännu</strong><p>Aktivitet visas när föreningen börjar dokumenteras.</p></div>';
    const stats = document.querySelectorAll('.stat-card');
    stats[0].querySelector('strong').textContent = '0';
    stats[0].querySelector('small').textContent = 'Inga fastigheter';
    stats[1].querySelector('strong').textContent = '0';
    stats[1].querySelector('small').textContent = 'Inga lägenheter importerade';
    const ring = stats[1].querySelector('.ring'); if (ring) { ring.style.setProperty('--progress', 0); ring.querySelector('span').textContent = '0%'; }
    stats[2].querySelector('strong').textContent = 'Ingen ännu';
    stats[2].querySelector('small').textContent = 'Ej registrerad';
    stats[3].querySelector('strong').textContent = 'Ej planerad';
    stats[3].querySelector('small').textContent = 'Planeras senare';
    document.querySelector('.status-panel h2').textContent = 'Ingen OVK registrerad ännu';
    document.querySelector('.status-panel p').textContent = 'Lägg till en förening och dess lägenheter för att börja dokumentera ventilationen.';
    document.querySelector('.status-chip').textContent = 'KOM IGÅNG';
    document.querySelector('.page-heading h1').textContent = 'God morgon, Kewin';
    document.querySelector('.page-heading .eyebrow').textContent = new Intl.DateTimeFormat('sv-SE', { weekday:'long', day:'numeric', month:'long' }).format(new Date()).toUpperCase();
  }

  function showPilotImport(){
    window.procellaApp.openModal(`
      <p class="eyebrow">FÖRSTA RIKTIGA FÖRENINGEN</p>
      <h2 id="modalTitle">Lägg till ${pilot.name}</h2>
      <p class="subtitle">Offentliga grunduppgifter är hämtade från föreningens webbplats. Kontrollera dem innan de sparas.</p>
      <form id="pilotImportForm">
        <div class="import-summary">
          <div><span>Förening</span><strong>${pilot.name}</strong></div>
          <div><span>Fastighetsbeteckning</span><strong>${pilot.propertyDesignation}</strong></div>
          <div><span>Adresser</span><strong>Karlbergsvägen 70 A-B<br>Norrbackagatan 21-25</strong></div>
          <div><span>Lägenheter</span><strong>${pilot.apartmentCount} totalt, varav ${pilot.rentalCount} hyresrätter</strong></div>
          <div><span>Styrelsens e-post</span><strong>${pilot.boardEmail}</strong></div>
        </div>
        <p class="source-note">Källa: <a href="${pilot.source}" target="_blank" rel="noopener">Föreningens webbplats ↗</a></p>
        <div class="modal-footer">
          <button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button>
          <button class="primary-button" id="pilotImportButton">Lägg till föreningen</button>
        </div>
      </form>`);
  }

  function showAddBrf(){
    window.procellaApp.openModal(`
      <p class="eyebrow">NY FÖRENING</p>
      <h2 id="modalTitle">Lägg till BRF</h2>
      <p class="subtitle">Börja med föreningens grunduppgifter och första adress. Fler adresser kan läggas till senare.</p>
      <form id="newBrfForm">
        <div class="form-grid">
          <label class="full">Föreningens namn<input name="name" required placeholder="Ex. BRF Eken 12"></label>
          <label>Organisationsnummer<input name="organization_number" placeholder="XXXXXX-XXXX"></label>
          <label>Styrelsens e-post<input name="email" type="email" placeholder="styrelsen@brf.se"></label>
          <label class="full">Första adress<input name="street_address" required placeholder="Gatuadress och port"></label>
          <label>Postnummer<input name="postal_code" placeholder="123 45"></label>
          <label>Ort<input name="city" required value="Stockholm"></label>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button" id="newBrfSubmit">Lägg till föreningen</button></div>
      </form>`);
  }

  function showBrfSelector(){
    window.procellaApp.openModal(`
      <p class="eyebrow">PROCELLAS FÖRENINGAR</p>
      <h2 id="modalTitle">Välj BRF</h2>
      <p class="subtitle">Du har åtkomst till ${availableBrfs.length} förening${availableBrfs.length === 1 ? '' : 'ar'}.</p>
      <div class="brf-picker">
        ${availableBrfs.map(brf => `<button type="button" data-select-brf="${brf.id}" class="${brf.id === activeBrfId ? 'active':''}"><span class="brf-picker-icon">BRF</span><div><strong>${brf.name}</strong><small>${brf.address || brf.city || 'Adress saknas'}</small></div><b>${brf.id === activeBrfId ? 'Vald ✓':'Öppna →'}</b></button>`).join('')}
      </div>
      <div class="modal-footer"><button class="primary-button" type="button" data-add-brf-from-picker>＋ Lägg till ny BRF</button></div>`);
  }

  async function createBrf(form){
    const submit = document.querySelector('#newBrfSubmit');
    submit.disabled = true; submit.textContent = 'Sparar…';
    const values = Object.fromEntries(new FormData(form));
    try {
      const { data: brf, error } = await window.procellaDb.from('brfs').insert({
        name: values.name, organization_number: values.organization_number || null,
        email: values.email || null, address: values.street_address,
        postal_code: values.postal_code || null, city: values.city
      }).select().single();
      if(error) throw error;
      const { error: propertyError } = await window.procellaDb.from('properties').insert({
        brf_id: brf.id, name: values.name, street_address: values.street_address,
        postal_code: values.postal_code || null, city: values.city, stairwells: 1
      });
      if(propertyError) throw propertyError;
      activeBrfId = brf.id; localStorage.setItem('procella_active_brf', brf.id);
      window.procellaApp.closeModal(); window.procellaApp.showToast(`${values.name} har lagts till`);
      await loadLiveData();
    }catch(error){ submit.disabled=false; submit.textContent='Försök igen'; showFormError(submit,error.message); }
  }

  function showFormError(button,message){
    document.querySelector('.modal .auth-message.error')?.remove();
    const element=document.createElement('p'); element.className='auth-message error'; element.textContent=message;
    button.closest('.modal-footer').before(element);
  }

  async function importPilot(){
    const button = document.querySelector('#pilotImportButton');
    button.disabled = true;
    button.textContent = 'Sparar…';
    try {
      const { data: brf, error: brfError } = await window.procellaDb.from('brfs').insert({
        name: pilot.name,
        address: 'Karlbergsvägen 70 A-B / Norrbackagatan 21-25',
        city: pilot.city,
        email: pilot.boardEmail
      }).select().single();
      if (brfError) throw brfError;

      const { error: propertiesError } = await window.procellaDb.from('properties').insert(
        pilot.properties.map(property => ({ ...property, brf_id: brf.id, name: pilot.propertyDesignation }))
      );
      if (propertiesError) throw propertiesError;

      const { error: contactError } = await window.procellaDb.from('board_contacts').insert({
        brf_id: brf.id,
        name: 'Styrelsen',
        title: 'Gemensam kontakt',
        email: pilot.boardEmail,
        ovk_responsible: false
      });
      if (contactError) throw contactError;

      window.procellaApp.closeModal();
      window.procellaApp.showToast(`${pilot.name} har lagts till`);
      await loadLiveData();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Försök igen';
      const message = document.createElement('p');
      message.className = 'auth-message error';
      message.textContent = error.message || 'Föreningen kunde inte sparas.';
      button.closest('.modal-footer').before(message);
    }
  }

  async function loadLiveData(){
    if (!window.procellaDb || document.body.classList.contains('demo-mode')) return;
    const { data: brfs, error } = await window.procellaDb.from('brfs').select('id,name,address,city,email').order('created_at');
    if (error) {
      window.procellaApp.showToast(`Databasfel: ${error.message}`);
      return;
    }
    resetExampleContent();
    if (!brfs.length) { showPilotImport(); return; }
    availableBrfs = brfs;
    if(!brfs.some(brf => brf.id === activeBrfId)) activeBrfId = brfs[0].id;
    localStorage.setItem('procella_active_brf', activeBrfId);
    const brf = brfs.find(item => item.id === activeBrfId);
    window.procellaCurrentBrf = brf;
    const [{ data: properties }, { data: apartmentRows }, { data: roomRows }, { data: unitRows }, { data: inspections }, { data: deviations }] = await Promise.all([
      window.procellaDb.from('properties').select('id,brf_id,street_address,city,stairwells').eq('brf_id', brf.id),
      window.procellaDb.from('apartments').select('id,property_id,apartment_number,rooms_count'),
      window.procellaDb.from('rooms').select('id,apartment_id'),
      window.procellaDb.from('ventilation_units').select('id,room_id'),
      window.procellaDb.from('inspections').select('id,status,inspection_date,next_due_date').eq('brf_id', brf.id).order('inspection_date', { ascending: false }),
      window.procellaDb.from('deviations').select('id,status').eq('brf_id', brf.id)
    ]);

    const propertyIds = new Set((properties || []).map(p => p.id));
    const scopedApartments = (apartmentRows || []).filter(a => propertyIds.has(a.property_id));
    const app = window.procellaApp;
    app.buildings.splice(0, app.buildings.length, ...(properties || []).map(property => {
      const count = scopedApartments.filter(a => a.property_id === property.id).length;
      return { address: property.street_address, info: `${count} lägenheter · ${property.stairwells} trapphus`, progress: count ? 0 : 0 };
    }));
    const roomsByApartment = (roomRows || []).reduce((map, room) => ((map[room.apartment_id] ||= []).push(room), map), {});
    const unitsByRoom = (unitRows || []).reduce((map, unit) => ((map[unit.room_id] ||= []).push(unit), map), {});
    app.apartments.splice(0, app.apartments.length, ...scopedApartments.map(apartment => {
      const property = (properties || []).find(p => p.id === apartment.property_id);
      const apartmentRooms = roomsByApartment[apartment.id] || [];
      const ventCount = apartmentRooms.reduce((sum, room) => sum + (unitsByRoom[room.id] || []).length, 0);
      return { id: apartment.id, brfId: brf.id, propertyId: apartment.property_id, no: apartment.apartment_number, roomsCount: apartment.rooms_count, address: property?.street_address || '', resident: 'Ingen boende kopplad', rooms: apartmentRooms.length, vents: ventCount, status: 'Dokumenterad' };
    }));
    app.apartments.sort((a,b) => a.address.localeCompare(b.address,'sv') || a.no.localeCompare(b.no,'sv'));
    app.renderBuildings();
    app.renderApartments();

    const filter = document.querySelector('#buildingFilter');
    filter.innerHTML = `<option value="all">Alla adresser</option>${(properties || []).map(property => `<option>${property.street_address}</option>`).join('')}`;

    document.querySelector('.crumb strong').textContent = brf.name;
    const stats = document.querySelectorAll('.stat-card');
    stats[0].querySelector('strong').textContent = (properties || []).length;
    stats[0].querySelector('small').textContent = `${(properties || []).reduce((sum,p)=>sum+p.stairwells,0)} trapphus`;
    stats[1].querySelector('strong').textContent = scopedApartments.length;
    stats[1].querySelector('small').textContent = brf.name === 'BRF Nya Skålen 20'
      ? (scopedApartments.length ? `${scopedApartments.length} importerade · ${Math.max(0,131-scopedApartments.length)} saknas` : '131 ska importeras')
      : `${scopedApartments.length} importerade`;
    if (inspections?.length) {
      stats[2].querySelector('strong').textContent = inspections[0].inspection_date || 'Utan datum';
      stats[2].querySelector('small').textContent = inspections[0].status;
      stats[3].querySelector('strong').textContent = inspections[0].next_due_date || 'Ej planerad';
      stats[3].querySelector('small').textContent = inspections[0].next_due_date ? 'Enligt senaste protokoll' : 'Planeras senare';
      document.querySelector('.status-chip').textContent = 'OVK 2026';
      document.querySelector('.status-panel h2').textContent = 'OVK-protokollet är importerat';
      document.querySelector('.status-panel p').textContent = `${scopedApartments.length} lägenheter med rum, ventilationspunkter och mätresultat finns nu i databasen.`;
    }
    const openDeviations = (deviations || []).filter(d => !['resolved','dismissed'].includes(d.status)).length;
    const alert = document.querySelector('.alert-banner');
    alert.hidden = openDeviations === 0;
    if (openDeviations) alert.querySelector('strong').textContent = `${openDeviations} förändringar behöver granskas`;
    const badge = document.querySelector('.nav-badge');
    badge.hidden = openDeviations === 0;
    badge.textContent = openDeviations;
    window.dispatchEvent(new CustomEvent('procella:brf-loaded',{detail:{brf,properties,apartments:scopedApartments}}));
  }

  document.addEventListener('submit', event => {
    if (event.target.id === 'pilotImportForm') { event.preventDefault(); importPilot(); }
    if (event.target.id === 'newBrfForm') { event.preventDefault(); createBrf(event.target); }
  });
  document.addEventListener('click',event=>{
    const select=event.target.closest('[data-select-brf]');
    if(select){ activeBrfId=select.dataset.selectBrf; localStorage.setItem('procella_active_brf',activeBrfId); window.procellaApp.closeModal(); loadLiveData(); }
    if(event.target.closest('[data-add-brf-from-picker]')) showAddBrf();
  });
  document.querySelector('#addPilotBrf').addEventListener('click', showAddBrf);
  document.querySelector('.crumb').addEventListener('click', showBrfSelector);
  window.showPilotImport = showPilotImport;
  window.procellaBrfManager={reload:loadLiveData,showSelector:showBrfSelector,showAdd:showAddBrf,getActive:()=>window.procellaCurrentBrf};
  window.addEventListener('procella:session', loadLiveData);
  window.addEventListener('procella:data-changed', loadLiveData);
  if (window.procellaDb) window.procellaDb.auth.getSession().then(({data}) => { if (data.session) loadLiveData(); });
})();
