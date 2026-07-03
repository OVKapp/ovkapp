const buildings = [
  {address:'Solvägen 2', info:'28 lägenheter · 2 trapphus', progress:100},
  {address:'Solvägen 4', info:'32 lägenheter · 2 trapphus', progress:94},
  {address:'Parkgatan 8', info:'24 lägenheter · 2 trapphus', progress:88}
];

const apartments = [
  {no:'A-1101', address:'Solvägen 2', resident:'Eva Sjöberg', rooms:4, vents:6, status:'Godkänd'},
  {no:'A-1203', address:'Solvägen 2', resident:'Marcus Berg', rooms:3, vents:5, status:'Godkänd'},
  {no:'A-1302', address:'Solvägen 2', resident:'Lena Öst', rooms:2, vents:4, status:'Godkänd'},
  {no:'B-1102', address:'Solvägen 4', resident:'Oskar Nyström', rooms:4, vents:7, status:'Avvikelse'},
  {no:'B-1201', address:'Solvägen 4', resident:'Sara Lind', rooms:3, vents:5, status:'Godkänd'},
  {no:'C-1301', address:'Parkgatan 8', resident:'Per Holm', rooms:2, vents:4, status:'Åtgärdad'},
  {no:'C-1403', address:'Parkgatan 8', resident:'Mia Ek', rooms:4, vents:6, status:'Avvikelse'},
  {no:'C-1502', address:'Parkgatan 8', resident:'Ali Rahimi', rooms:3, vents:5, status:'Godkänd'},
  {no:'B-1304', address:'Solvägen 4', resident:'Anna Dahl', rooms:3, vents:5, status:'Godkänd'}
];

const changes = [
  {apt:'B-1102', room:'Badrum', date:'Upptäckt igår', type:'Ventilationsdon kan vara utbytt'},
  {apt:'C-1403', room:'Kök', date:'Upptäckt 18 juni', type:'Donet ser delvis blockerat ut'},
  {apt:'A-1203', room:'Kök', date:'Upptäckt 16 juni', type:'Inställningen kan ha förändrats'}
];

const buildingList = document.querySelector('#buildingList');
function renderBuildings(){
  buildingList.innerHTML = buildings.map(b => `<div class="building-row" data-go="properties"><div class="building-thumb"></div><div><strong>${b.address}</strong><p>${b.info}</p><div class="progress"><i style="width:${b.progress}%"></i></div></div><span class="percent">${b.progress}%</span></div>`).join('') || '<div class="empty-data"><strong>Inga fastigheter ännu</strong><p>Lägg till föreningens första fastighet för att komma igång.</p></div>';
}
renderBuildings();

function renderApartments(){
  const query = document.querySelector('#apartmentSearch').value.toLowerCase();
  const filter = document.querySelector('#buildingFilter').value;
  const rows = apartments.filter(a => (filter === 'all' || a.address === filter) && `${a.no} ${a.resident}`.toLowerCase().includes(query));
  document.querySelector('#apartmentGrid').innerHTML = rows.map(a => `<article class="apartment-card panel" data-apartment="${a.id || a.no}"><div class="apt-top"><div class="apt-no">${a.no.split('-')[0]}</div><span class="pill ${['Godkänd','Åtgärdad','Dokumenterad'].includes(a.status) ? 'approved':'issue'}">${a.status}</span></div><h3>Lägenhet ${a.no}</h3><p>${a.address} · ${a.resident}</p><div class="apt-meta"><span><b>${a.rooms}</b> rum</span><span><b>${a.vents}</b> ventilationsdon</span><span>${a.id ? 'OVK 2026' : 'Uppdaterad 2024'}</span></div></article>`).join('') || '<p>Inga lägenheter matchar sökningen.</p>';
}
renderApartments();

function renderChanges(selected=0){
  document.querySelector('#changeList').innerHTML = changes.map((c,i)=>`<div class="change-card ${i===selected?'active':''}" data-change="${i}"><div><strong>${c.apt} · ${c.room}</strong><span class="pill issue">Granska</span></div><p>${c.type}</p><small>${c.date}</small></div>`).join('');
  const c=changes[selected];
  document.querySelector('#comparison').innerHTML=`<div class="comparison-head"><div><h2>${c.apt} · ${c.room}</h2><p>${c.type}</p></div><span class="pill issue">Möjlig förändring</span></div><div class="compare-images"><div class="vent-photo"><span class="photo-label">OVK 2021</span></div><div class="vent-photo changed"><span class="photo-label">Nuvarande bild</span></div></div><p>Jämför bilderna och dokumentera ditt beslut. Beslutet sparas i lägenhetens historik med datum och användare.</p><div class="compare-actions"><button data-review="same">Ingen förändring</button><button data-review="action">Skapa åtgärd</button><button data-review="confirmed">Bekräfta förändring</button></div>`;
}
renderChanges();

function switchView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  document.querySelectorAll('.nav-link[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  document.querySelector('#sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
}

document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-view]'); if(nav) switchView(nav.dataset.view);
  const go=e.target.closest('[data-go]'); if(go) switchView(go.dataset.go);
  const apt=e.target.closest('[data-apartment]'); if(apt) openApartment(apt.dataset.apartment);
  const change=e.target.closest('[data-change]'); if(change) renderChanges(Number(change.dataset.change));
  const review=e.target.closest('[data-review]'); if(review){showToast(review.dataset.review==='same'?'Markerad som oförändrad':'Beslutet har sparats'); review.closest('.comparison').querySelector('.pill').textContent='Granskad'; review.closest('.comparison').querySelector('.pill').className='pill approved';}
});

document.querySelector('#apartmentSearch').addEventListener('input',renderApartments);
document.querySelector('#buildingFilter').addEventListener('change',renderApartments);
document.querySelector('#menuButton').addEventListener('click',()=>document.querySelector('#sidebar').classList.toggle('open'));

const backdrop=document.querySelector('#modalBackdrop');
function openModal(html){document.querySelector('#modalContent').innerHTML=html;backdrop.hidden=false;document.body.style.overflow='hidden';}
function closeModal(){backdrop.hidden=true;document.body.style.overflow='';}
document.querySelector('#modalClose').addEventListener('click',closeModal);
backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

function openApartment(key){
  const a=apartments.find(x=>(x.id && x.id===key) || (!x.id && x.no===key));
  if(a?.id && window.openLiveApartment){ window.openLiveApartment(a); return; }
  if(!a) return;
  const rooms=['Kök','Badrum','Vardagsrum','Sovrum'].slice(0,a.rooms);
  openModal(`<p class="eyebrow">${a.address.toUpperCase()}</p><h2 id="modalTitle">Lägenhet ${a.no}</h2><p class="subtitle">Boende: ${a.resident} · Senast dokumenterad 14 mars 2024</p><div class="modal-summary"><span>✓ ${a.status}</span><span>${a.rooms} rum</span><span>${a.vents} ventilationsdon</span></div><div class="room-grid">${rooms.map((r,i)=>`<div class="room-card"><strong>${r}</strong><p>${i<2?'Frånluftsdon':'Tilluftsdon'} · ${i%2+1} st</p><span class="pill approved">Dokumenterad</span></div>`).join('')}</div><div class="modal-footer"><button class="secondary-button" onclick="closeModal()">Stäng</button><button class="primary-button" onclick="showToast('Besiktningsvyn är öppnad')">Öppna besiktning</button></div>`);
}

document.querySelector('#addApartment').addEventListener('click',()=>openModal(`<h2 id="modalTitle">Lägg till lägenhet</h2><p class="subtitle">Registrera lägenheten i föreningens OVK-register.</p><form id="apartmentForm"><div class="form-grid"><label>Lägenhetsnummer<input name="no" required placeholder="Ex. A-1402"></label><label>Adress<select name="address">${buildings.map(b=>`<option>${b.address}</option>`).join('')}</select></label><label class="full">Boende<input name="resident" required placeholder="För- och efternamn"></label><label>Antal rum<input name="rooms" required type="number" min="1" value="3"></label><label>Ventilationsdon<input name="vents" required type="number" min="1" value="5"></label></div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button">Spara lägenhet</button></div></form>`));
document.querySelector('#newInspection').addEventListener('click',()=>openModal(`<h2 id="modalTitle">Ny besiktning</h2><p class="subtitle">Starta ett arbetsutkast för en kommande ventilationskontroll.</p><form id="inspectionForm"><div class="form-grid"><label class="full">Namn<input required value="OVK 2027"></label><label>Planerat datum<input required type="date" value="2027-03-15"></label><label>Besiktningsföretag<input value="Procella Ventilation AB"></label><label class="full">Omfattning<select><option>Alla 84 lägenheter</option><option>Valda fastigheter</option><option>Efterkontroll</option></select></label></div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button">Skapa utkast</button></div></form>`));

document.addEventListener('submit',e=>{
  if(!['apartmentForm','inspectionForm'].includes(e.target.id)) return;
  e.preventDefault();
  if(e.target.id==='apartmentForm'){
    const d=Object.fromEntries(new FormData(e.target)); apartments.unshift({no:d.no,address:d.address,resident:d.resident,rooms:Number(d.rooms),vents:Number(d.vents),status:'Godkänd'}); renderApartments(); closeModal(); showToast('Lägenheten har lagts till');
  } else {closeModal();showToast('Besiktningen har skapats');}
});

function showToast(message){const toast=document.querySelector('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>toast.classList.remove('show'),2400)}
window.closeModal=closeModal;window.showToast=showToast;
window.procellaApp={buildings,apartments,renderBuildings,renderApartments,openModal,closeModal,showToast,switchView};
