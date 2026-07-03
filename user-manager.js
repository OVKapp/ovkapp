(() => {
  let activeContext = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]);
  const roleLabel = role => ({procella_admin:'Procella-administratör',procella_staff:'Procella',board:'Styrelse',resident:'Boende'})[role] || role;

  async function renderUserManager(context){
    activeContext=context;
    const container=document.querySelector('#settings');
    const wasActive=container.classList.contains('active');
    container.className=`view${wasActive?' active':''}`;
    container.innerHTML=`<div class="settings-loading"><span class="loading-spinner"></span><p>Hämtar användare…</p></div>`;
    try{
      const [{data:profiles,error:profileError},{data:invitations,error:invitationError},{data:properties,error:propertyError}] = await Promise.all([
        window.procellaDb.from('profiles').select('id,email,full_name,role,brf_id,apartment_id,active').order('created_at'),
        window.procellaDb.from('access_invitations').select('id,email,full_name,role,brf_id,apartment_id,status,created_at,email_sent_at,email_delivery_status').order('created_at',{ascending:false}),
        window.procellaDb.from('properties').select('id,street_address').eq('brf_id',context.brf.id)
      ]);
      if(profileError)throw profileError;
      if(invitationError)throw invitationError;
      if(propertyError)throw propertyError;
      const propertyIds=properties.map(property=>property.id);
      const {data:apartments,error:apartmentError}=await window.procellaDb.from('apartments').select('id,property_id,apartment_number').in('property_id',propertyIds.length?propertyIds:['00000000-0000-0000-0000-000000000000']);
      if(apartmentError)throw apartmentError;
      activeContext={...context,profiles,invitations,properties,apartments};
      drawManager();
    }catch(error){
      const missing=error.message?.includes('access_invitations');
      container.innerHTML=`<div class="page-heading compact"><div><p class="eyebrow">INSTÄLLNINGAR</p><h1>Användare och behörigheter</h1></div></div><div class="setup-required panel"><strong>${missing?'Databassteget för användare behöver installeras':'Användarna kunde inte hämtas'}</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function drawManager(){
    const {brf,profiles,invitations}=activeContext;
    const visibleProfiles=profiles.filter(profile=>['procella_admin','procella_staff'].includes(profile.role)||profile.brf_id===brf.id);
    const visibleInvitations=invitations.filter(invitation=>invitation.role==='procella_staff'||invitation.brf_id===brf.id);
    const container=document.querySelector('#settings');
    container.innerHTML=`
      <div class="page-heading compact"><div><p class="eyebrow">INSTÄLLNINGAR · ${escapeHtml(brf.name.toUpperCase())}</p><h1>Användare och behörigheter</h1><p>Hantera vilka som får se Procella-systemet, föreningen och enskilda lägenheter.</p></div><button class="primary-button" data-open-invite>＋ Lägg till användare</button></div>
      <div class="access-explainer">
        <div><span>P</span><strong>Procella</strong><p>Ser alla BRF:er och all dokumentation.</p></div>
        <div><span>S</span><strong>Styrelse</strong><p>Ser endast ${escapeHtml(brf.name)}.</p></div>
        <div><span>B</span><strong>Boende</strong><p>Ser endast sin kopplade lägenhet.</p></div>
      </div>
      <article class="panel user-panel"><div class="panel-head"><div><h2>Aktiva användare</h2><p>${visibleProfiles.length} konton</p></div></div>
        <div class="user-table">${visibleProfiles.map(profile=>userRow(profile)).join('')||'<div class="empty-data">Inga aktiva användare.</div>'}</div>
      </article>
      <article class="panel user-panel"><div class="panel-head"><div><h2>Väntande inbjudningar</h2><p>Personen aktiveras när kontot skapas med samma e-postadress.</p></div></div>
        <div class="user-table">${visibleInvitations.filter(item=>item.status==='pending').map(invitation=>inviteRow(invitation)).join('')||'<div class="empty-data">Inga väntande inbjudningar.</div>'}</div>
      </article>
      <div id="notificationSettings"></div>
      <div id="billingSettings"></div>`;
    container.querySelector('[data-open-invite]').addEventListener('click',showInviteForm);
    container.querySelectorAll('[data-revoke-invite]').forEach(button=>button.addEventListener('click',()=>revokeInvite(button.dataset.revokeInvite)));
    container.querySelectorAll('[data-resend-invite]').forEach(button=>button.addEventListener('click',()=>resendInvitation(button.dataset.resendInvite)));
    window.dispatchEvent(new CustomEvent('procella:settings-rendered'));
  }

  function userRow(profile){
    const apartment=activeContext.apartments.find(item=>item.id===profile.apartment_id);
    const property=apartment&&activeContext.properties.find(item=>item.id===apartment.property_id);
    return `<div class="user-table-row"><span class="user-list-avatar">${escapeHtml((profile.full_name||profile.email).charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(profile.full_name||profile.email)}</strong><small>${escapeHtml(profile.email)}</small></div><span class="role-chip ${profile.role}">${roleLabel(profile.role)}</span><span class="user-scope">${apartment?`${escapeHtml(property?.street_address)} · ${escapeHtml(apartment.apartment_number)}`:profile.role==='board'?escapeHtml(activeContext.brf.name):'Alla föreningar'}</span></div>`;
  }

  function inviteRow(invitation){
    const apartment=activeContext.apartments.find(item=>item.id===invitation.apartment_id);
    const delivery=invitation.email_delivery_status==='sent'?'Mejl skickat':invitation.email_delivery_status==='failed'?'Mejl misslyckades':'Mejl ej skickat';
    return `<div class="user-table-row"><span class="user-list-avatar pending">${escapeHtml((invitation.full_name||invitation.email).charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(invitation.full_name||invitation.email)}</strong><small>${escapeHtml(invitation.email)} · ${delivery}</small></div><span class="role-chip ${invitation.role}">${roleLabel(invitation.role)}</span><span class="user-scope">${apartment?`Lägenhet ${escapeHtml(apartment.apartment_number)}`:'Väntar på konto'}</span><span class="invite-actions"><button data-resend-invite="${invitation.id}">Skicka igen</button><button class="text-danger" data-revoke-invite="${invitation.id}">Återkalla</button></span></div>`;
  }

  function showInviteForm(){
    const options=activeContext.apartments.slice().sort((a,b)=>a.apartment_number.localeCompare(b.apartment_number,'sv')).map(apartment=>{
      const property=activeContext.properties.find(item=>item.id===apartment.property_id);
      return `<option value="${apartment.id}">${escapeHtml(property?.street_address)} · ${escapeHtml(apartment.apartment_number)}</option>`;
    }).join('');
    window.procellaApp.openModal(`
      <p class="eyebrow">NY ANVÄNDARE</p><h2 id="modalTitle">Lägg till användare</h2><p class="subtitle">Behörigheten kopplas automatiskt när personen skapar sitt konto med samma e-postadress.</p>
      <form id="inviteUserForm"><div class="form-grid">
        <label class="full">Namn<input name="full_name" required placeholder="För- och efternamn"></label>
        <label class="full">E-postadress<input name="email" type="email" required placeholder="namn@exempel.se"></label>
        <label class="full">Behörighet<select name="role" id="inviteRole"><option value="board">Styrelse – endast aktuell BRF</option><option value="resident">Boende – endast egen lägenhet</option><option value="procella_staff">Procella – alla föreningar</option></select></label>
        <label class="full" id="apartmentInviteField" hidden>Lägenhet<select name="apartment_id"><option value="">Välj lägenhet</option>${options}</select></label>
      </div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button" id="saveInvitation">Skapa inbjudan</button></div></form>`);
    const role=document.querySelector('#inviteRole'); const apartmentField=document.querySelector('#apartmentInviteField');
    role.addEventListener('change',()=>{apartmentField.hidden=role.value!=='resident';apartmentField.querySelector('select').required=role.value==='resident';});
    document.querySelector('#inviteUserForm').addEventListener('submit',saveInvitation);
  }

  async function saveInvitation(event){
    event.preventDefault(); const submit=document.querySelector('#saveInvitation');submit.disabled=true;submit.textContent='Sparar…';
    const values=Object.fromEntries(new FormData(event.target));
    try{
      const {data:{user}}=await window.procellaDb.auth.getUser();
      const payload={email:values.email.trim().toLowerCase(),full_name:values.full_name.trim(),role:values.role,brf_id:values.role==='procella_staff'?null:activeContext.brf.id,apartment_id:values.role==='resident'?values.apartment_id:null,invited_by:user.id};
      const {data:invitation,error}=await window.procellaDb.from('access_invitations').insert(payload).select('id').single();if(error)throw error;
      if(values.role==='board')await window.procellaDb.from('board_contacts').insert({brf_id:activeContext.brf.id,name:payload.full_name,email:payload.email,title:'Styrelseledamot'});
      const emailError=await deliverInvitation(invitation.id);
      window.procellaApp.closeModal();window.procellaApp.showToast(emailError?'Inbjudan sparades, men mejlet kunde inte skickas':'Inbjudan och mejl har skickats');await renderUserManager(activeContext);
    }catch(error){submit.disabled=false;submit.textContent='Försök igen';showError(submit,error.message);}
  }

  async function revokeInvite(id){
    const {error}=await window.procellaDb.from('access_invitations').update({status:'revoked'}).eq('id',id);
    if(error)window.procellaApp.showToast(error.message);else{window.procellaApp.showToast('Inbjudan återkallad');await renderUserManager(activeContext);}
  }
  async function deliverInvitation(id){
    try{
      const {error}=await window.procellaDb.functions.invoke('send-invitation',{body:{invitation_id:id}});
      return error||null;
    }catch(error){return error;}
  }
  async function resendInvitation(id){
    const error=await deliverInvitation(id);
    window.procellaApp.showToast(error?'Mejlet kunde inte skickas':'Inbjudningsmejlet har skickats');
    await renderUserManager(activeContext);
  }
  function showError(button,message){document.querySelector('.modal .auth-message.error')?.remove();const p=document.createElement('p');p.className='auth-message error';p.textContent=message;button.closest('.modal-footer').before(p);}

  window.addEventListener('procella:brf-loaded',event=>renderUserManager(event.detail));
  document.querySelector('[data-view="settings"]').addEventListener('click',()=>window.procellaBrfManager?.reload());
})();
