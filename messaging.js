(() => {
  let context = null;
  let state = { conversations:[], participants:[], messages:[], profiles:[], selectedId:null };
  const section = document.querySelector('#messages');
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]);
  const categoryLabel = value => ({notice:'Avisering',renovation:'Renovering',ventilation:'Ventilationsfråga',inspection:'OVK',general:'Övrigt'})[value] || value;
  const dateLabel = value => value ? new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '';

  async function loadMessages(preferredId = null){
    if(!context || !window.procellaCurrentProfile) return;
    section.innerHTML='<div class="settings-loading"><span class="loading-spinner"></span><p>Hämtar meddelanden…</p></div>';
    try{
      const {data:conversations,error}=await window.procellaDb.from('conversations')
        .select('id,brf_id,apartment_id,subject,category,created_by,created_at,updated_at,closed_at')
        .eq('brf_id',context.brf.id).order('updated_at',{ascending:false});
      if(error)throw error;
      const ids=conversations.map(item=>item.id);
      const [{data:participants,error:participantError},{data:messages,error:messageError},{data:profiles,error:profileError}] = await Promise.all([
        ids.length?window.procellaDb.from('conversation_participants').select('conversation_id,profile_id,last_read_at').in('conversation_id',ids):Promise.resolve({data:[],error:null}),
        ids.length?window.procellaDb.from('messages').select('id,conversation_id,sender_id,body,created_at').in('conversation_id',ids).order('created_at'):Promise.resolve({data:[],error:null}),
        window.procellaDb.from('profiles').select('id,email,full_name,role,brf_id,apartment_id,active')
      ]);
      if(participantError)throw participantError;if(messageError)throw messageError;if(profileError)throw profileError;
      state={conversations,participants,messages,profiles,selectedId:preferredId||state.selectedId||conversations[0]?.id||null};
      updateUnreadBadge(); drawMessages();
    }catch(error){
      const missing=error.message?.includes('conversations');
      section.innerHTML=`<div class="page-heading compact"><div><p class="eyebrow">MEDDELANDEN</p><h1>Inkorg</h1></div></div><div class="setup-required panel"><strong>${missing?'Meddelandecentralen behöver installeras':'Meddelandena kunde inte hämtas'}</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function updateUnreadBadge(){
    const me=window.procellaCurrentProfile.id;
    const unread=state.conversations.filter(conversation=>{
      const participant=state.participants.find(item=>item.conversation_id===conversation.id&&item.profile_id===me);
      return !participant?.last_read_at || new Date(conversation.updated_at)>new Date(participant.last_read_at);
    }).length;
    const badge=document.querySelector('.message-nav-badge');badge.textContent=unread;badge.hidden=unread===0;
  }

  function drawMessages(){
    section.innerHTML=`
      <div class="page-heading compact"><div><p class="eyebrow">${escapeHtml(context.brf.name.toUpperCase())}</p><h1>Meddelanden</h1><p>Aviseringar och frågor om ventilation samlade per förening.</p></div><button class="primary-button" data-new-message>＋ Nytt meddelande</button></div>
      <div class="message-layout panel">
        <aside class="conversation-list">
          <div class="conversation-list-head"><strong>Inkorg</strong><span>${state.conversations.length}</span></div>
          ${state.conversations.map(conversationCard).join('')||'<div class="empty-data"><strong>Inga meddelanden ännu</strong><p>Starta en avisering eller fråga.</p></div>'}
        </aside>
        <div class="thread-view" id="threadView">${renderThread()}</div>
      </div>`;
    section.querySelector('[data-new-message]').addEventListener('click',showComposer);
    section.querySelectorAll('[data-conversation]').forEach(button=>button.addEventListener('click',()=>openConversation(button.dataset.conversation)));
    section.querySelector('#replyForm')?.addEventListener('submit',sendReply);
    if(state.selectedId) markRead(state.selectedId);
  }

  function conversationCard(conversation){
    const latest=[...state.messages].reverse().find(message=>message.conversation_id===conversation.id);
    const me=window.procellaCurrentProfile.id;
    const participant=state.participants.find(item=>item.conversation_id===conversation.id&&item.profile_id===me);
    const unread=!participant?.last_read_at||new Date(conversation.updated_at)>new Date(participant.last_read_at);
    return `<button class="conversation-card ${conversation.id===state.selectedId?'active':''}" data-conversation="${conversation.id}"><span class="conversation-category">${conversation.category==='notice'?'!':'✉'}</span><div><strong>${escapeHtml(conversation.subject)}</strong><p>${escapeHtml(latest?.body||'Ingen text')}</p><small>${categoryLabel(conversation.category)} · ${dateLabel(conversation.updated_at)}</small></div>${unread?'<i></i>':''}</button>`;
  }

  function renderThread(){
    const conversation=state.conversations.find(item=>item.id===state.selectedId);
    if(!conversation)return '<div class="thread-empty"><span>✉</span><h2>Välj en konversation</h2><p>Eller skapa ett nytt meddelande.</p></div>';
    const messages=state.messages.filter(message=>message.conversation_id===conversation.id);
    const myId=window.procellaCurrentProfile.id;
    return `<div class="thread-head"><div><span class="pill neutral">${categoryLabel(conversation.category)}</span><h2>${escapeHtml(conversation.subject)}</h2></div><small>Startad ${dateLabel(conversation.created_at)}</small></div>
      <div class="thread-messages">${messages.map(message=>{
        const own=message.sender_id===myId;const sender=state.profiles.find(profile=>profile.id===message.sender_id);
        return `<div class="message-bubble ${own?'own':''}"><div><strong>${own?'Du':escapeHtml(sender?.full_name||sender?.email||'Styrelsen / Procella')}</strong><small>${dateLabel(message.created_at)}</small></div><p>${escapeHtml(message.body).replace(/\n/g,'<br>')}</p></div>`;
      }).join('')}</div>
      <form class="reply-form" id="replyForm"><textarea name="body" required maxlength="10000" placeholder="Skriv ett svar…"></textarea><button class="primary-button">Skicka</button></form>`;
  }

  async function openConversation(id){state.selectedId=id;drawMessages();}
  async function markRead(id){
    const me=window.procellaCurrentProfile.id;
    await window.procellaDb.from('conversation_participants').upsert({conversation_id:id,profile_id:me,last_read_at:new Date().toISOString()},{onConflict:'conversation_id,profile_id'});
    const participant=state.participants.find(item=>item.conversation_id===id&&item.profile_id===me);
    if(participant)participant.last_read_at=new Date().toISOString();else state.participants.push({conversation_id:id,profile_id:me,last_read_at:new Date().toISOString()});
    updateUnreadBadge();
  }

  function showComposer(){
    const profile=window.procellaCurrentProfile;
    const senderCanBroadcast=['procella_admin','procella_staff','board'].includes(profile.role);
    const residents=state.profiles.filter(item=>item.role==='resident'&&item.brf_id===context.brf.id&&item.active);
    window.procellaApp.openModal(`
      <p class="eyebrow">NYTT MEDDELANDE</p><h2 id="modalTitle">${senderCanBroadcast?'Skicka avisering eller meddelande':'Fråga styrelsen och Procella'}</h2>
      <p class="subtitle">${senderCanBroadcast?'Välj samtliga boende eller särskilda mottagare.':'Din fråga blir synlig för föreningens styrelse och Procella.'}</p>
      <form id="composeMessageForm"><div class="form-grid">
        <label>Kategori<select name="category"><option value="notice">Avisering</option><option value="inspection">OVK</option><option value="ventilation">Ventilation</option><option value="renovation" ${senderCanBroadcast?'':'selected'}>Renovering</option><option value="general">Övrigt</option></select></label>
        ${senderCanBroadcast?`<label>Mottagare<select name="recipient_mode" id="recipientMode"><option value="all">Samtliga boende</option><option value="selected">Särskilda boende</option></select></label>`:''}
        <label class="full">Rubrik<input name="subject" required maxlength="180" placeholder="Ex. Tillträde för OVK den 14 mars"></label>
        <label class="full">Meddelande<textarea name="body" required maxlength="10000" rows="6" placeholder="Skriv meddelandet här…"></textarea></label>
      </div>
      ${senderCanBroadcast?`<div class="resident-picker" id="residentPicker" hidden><strong>Välj boende</strong>${residents.map(resident=>{const apt=context.apartments.find(item=>item.id===resident.apartment_id);return `<label><input type="checkbox" name="resident_ids" value="${resident.id}"><span>${escapeHtml(resident.full_name||resident.email)}</span><small>${apt?`Lägenhet ${escapeHtml(apt.apartment_number)}`:''}</small></label>`}).join('')||'<p>Det finns inga aktiva boendekonton ännu.</p>'}</div>`:''}
      <div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button" id="sendNewMessage">Skicka meddelandet</button></div></form>`);
    document.querySelector('#recipientMode')?.addEventListener('change',event=>document.querySelector('#residentPicker').hidden=event.target.value!=='selected');
    document.querySelector('#composeMessageForm').addEventListener('submit',createConversation);
  }

  async function createConversation(event){
    event.preventDefault();const button=document.querySelector('#sendNewMessage');button.disabled=true;button.textContent='Skickar…';
    const form=new FormData(event.target),profile=window.procellaCurrentProfile,broadcast=['procella_admin','procella_staff','board'].includes(profile.role);
    try{
      let recipientIds=[];
      if(broadcast){
        const residents=state.profiles.filter(item=>item.role==='resident'&&item.brf_id===context.brf.id&&item.active);
        recipientIds=form.get('recipient_mode')==='all'?residents.map(item=>item.id):form.getAll('resident_ids');
        if(!recipientIds.length)throw new Error('Det finns inga valda aktiva boendekonton. Lägg först till boende under Inställningar.');
      }else recipientIds=[profile.id];
      const conversationId=crypto.randomUUID();
      const {error:conversationError}=await window.procellaDb.from('conversations').insert({id:conversationId,brf_id:context.brf.id,apartment_id:profile.role==='resident'?profile.apartment_id:null,subject:form.get('subject').trim(),category:form.get('category'),created_by:profile.id});
      if(conversationError)throw conversationError;
      const participantIds=[...new Set([profile.id,...recipientIds])];
      const {error:participantError}=await window.procellaDb.from('conversation_participants').insert(participantIds.map(id=>({conversation_id:conversationId,profile_id:id,last_read_at:id===profile.id?new Date().toISOString():null})));
      if(participantError)throw participantError;
      const {data:newMessage,error:messageError}=await window.procellaDb.from('messages').insert({conversation_id:conversationId,sender_id:profile.id,body:form.get('body').trim()}).select('id').single();
      if(messageError)throw messageError;
      window.procellaNotifications?.notifyMessage(newMessage.id);
      window.procellaApp.closeModal();window.procellaApp.showToast('Meddelandet har skickats');state.selectedId=conversationId;await loadMessages(conversationId);window.procellaApp.switchView('messages');
    }catch(error){button.disabled=false;button.textContent='Försök igen';showError(button,error.message);}
  }

  async function sendReply(event){
    event.preventDefault();const body=new FormData(event.target).get('body').trim(),button=event.target.querySelector('button');button.disabled=true;
    const {data:newMessage,error}=await window.procellaDb.from('messages').insert({conversation_id:state.selectedId,sender_id:window.procellaCurrentProfile.id,body}).select('id').single();
    if(error){button.disabled=false;window.procellaApp.showToast(error.message);return;}await loadMessages(state.selectedId);
    window.procellaNotifications?.notifyMessage(newMessage.id);
  }
  function showError(button,message){document.querySelector('.modal .auth-message.error')?.remove();const p=document.createElement('p');p.className='auth-message error';p.textContent=message;button.closest('.modal-footer').before(p);}

  window.addEventListener('procella:brf-loaded',event=>{context=event.detail;loadMessages();});
  document.querySelector('[data-view="messages"]').addEventListener('click',()=>{
    if(context) loadMessages();
    else window.procellaBrfManager?.reload?.();
  });
})();
