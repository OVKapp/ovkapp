(() => {
  let profile=null;
  let context=null;
  let subscription=null;
  let autogiroRequest=null;
  let invoiceRequest=null;
  let latestInvoice=null;
  const procellaRoles=['procella_admin','procella_staff'];
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]);
  const formatDate=value=>value?new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value)):'–';
  const planLabel=code=>({small:'0–99 lägenheter',medium:'100–199 lägenheter',large:'200–499 lägenheter',custom:'500+ lägenheter'})[code]||code;
  const priceLabel=item=>item.monthly_price_ore?`${item.monthly_price_ore/100} kr/mån exkl. moms`:'Personlig offert';
  const daysLeft=item=>item.trial_ends_at?Math.max(0,Math.ceil((new Date(item.trial_ends_at)-new Date())/86400000)):null;
  const hasAccess=item=>{
    if(!item)return true;
    if(item.status==='active')return true;
    if(['pending','trialing'].includes(item.status)&&(!item.trial_ends_at||new Date(item.trial_ends_at)>new Date()))return true;
    return item.cancel_at_period_end&&item.current_period_ends_at&&new Date(item.current_period_ends_at)>new Date();
  };

  async function loadSubscription(brfId){
    if(!brfId||!window.procellaDb)return;
    const [{data,error},{data:autogiro},{data:invoiceReq},{data:invoices}]=await Promise.all([
      window.procellaDb.from('brf_subscriptions').select('*').eq('brf_id',brfId).maybeSingle(),
      window.procellaDb.from('autogiro_requests').select('*').eq('brf_id',brfId).in('status',['requested','quoted','active']).maybeSingle(),
      window.procellaDb.from('invoice_payment_requests').select('*').eq('brf_id',brfId).in('status',['requested','approved','active']).maybeSingle(),
      window.procellaDb.from('subscription_invoices').select('*').eq('brf_id',brfId).order('period_ends_at',{ascending:false}).limit(1)
    ]);
    if(error){if(!error.message?.includes('brf_subscriptions'))console.warn(error.message);return;}
    subscription=data;
    autogiroRequest=autogiro||null;
    invoiceRequest=invoiceReq||null;
    latestInvoice=invoices?.[0]||null;
    drawOverview();drawSettings();drawLock();
  }

  function statusContent(item){
    const remaining=daysLeft(item);
    if(item.status==='pending')return {label:'Provperiod ej startad',text:'Tre månader börjar när första styrelsekontot aktiveras.'};
    if(item.status==='trialing'&&remaining>0)return {label:`${remaining} dagar kvar`,text:`Provperioden gäller till ${formatDate(item.trial_ends_at)}.`};
    if(item.status==='active')return {label:'Aktivt abonnemang',text:item.current_period_ends_at?`Nästa period börjar ${formatDate(item.current_period_ends_at)}.`:'Månadsbetalningen är aktiv.'};
    if(item.status==='past_due')return {label:'Betalning saknas',text:'Betalningen behöver uppdateras för att återställa åtkomsten.'};
    return {label:'Åtkomst pausad',text:item.data_deletion_at?`Föreningens information raderas ${formatDate(item.data_deletion_at)} om betalningen inte aktiveras.`:'Betalningen behöver aktiveras för att undvika radering.'};
  }

  function drawOverview(){
    document.querySelector('#subscriptionOverview')?.remove();
    if(!subscription||profile?.role==='resident')return;
    const heading=document.querySelector('#overview .page-heading');if(!heading)return;
    const status=statusContent(subscription),banner=document.createElement('div');banner.id='subscriptionOverview';banner.className=`subscription-banner ${hasAccess(subscription)?'':'expired'}`;
    banner.innerHTML=`<div><span>ABONNEMANG</span><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.text)}</p></div><div><strong>${escapeHtml(priceLabel(subscription))}</strong><small>${subscription.apartment_count} lägenheter · ${escapeHtml(planLabel(subscription.plan_code))}</small></div>`;
    heading.after(banner);
  }

  function drawSettings(){
    const container=document.querySelector('#billingSettings');if(!container||!subscription)return;
    const status=statusContent(subscription),canPay=profile?.role==='board'||procellaRoles.includes(profile?.role),hasCustomer=Boolean(subscription.stripe_customer_id);
    const autogiroPrice=autogiroRequest?.customer_addon_ore!=null?`${autogiroRequest.customer_addon_ore/100} kr/mån exkl. moms`:'Leverantörens kostnad + 10 %';
    const invoiceText=latestInvoice?.status==='paid'?`Betald till och med ${formatDate(latestInvoice.period_ends_at)}.`:invoiceRequest?`Förfrågan registrerad. Fakturan måste betalas före nästa månadsperiod.`:'En månad faktureras och betalas i förskott.';
    const autogiroAction=profile?.role==='board'&&!autogiroRequest?'<button class="secondary-button small-button" data-request-autogiro>Begär Autogiro</button>':procellaRoles.includes(profile?.role)&&autogiroRequest?'<button class="secondary-button small-button" data-quote-autogiro>Prissätt tillval</button>':'';
    const invoiceAction=profile?.role==='board'&&!invoiceRequest?'<button class="secondary-button small-button" data-request-invoice>Begär faktura</button>':procellaRoles.includes(profile?.role)&&invoiceRequest?'<button class="secondary-button small-button" data-register-invoice>Registrera betald</button>':'';
    container.innerHTML=`<article class="panel billing-panel"><div class="panel-head"><div><h2>Provperiod och abonnemang</h2><p>Priset räknas automatiskt från antalet lägenheter.</p></div><span class="billing-status ${subscription.status}">${escapeHtml(status.label)}</span></div><div class="billing-summary"><div><span>Storlek</span><strong>${subscription.apartment_count} lägenheter</strong><small>${escapeHtml(planLabel(subscription.plan_code))}</small></div><div><span>Månadspris</span><strong>${escapeHtml(priceLabel(subscription))}</strong><small>Betalas månadsvis</small></div><div><span>Raderingsdatum utan betalning</span><strong>${subscription.data_deletion_at?formatDate(subscription.data_deletion_at):'Ingen radering planerad'}</strong><small>Provperioden är tre månader</small></div></div><div class="payment-methods"><div><span>↻</span><div><strong>Automatisk kortbetalning</strong><p>Standardval. Kortet debiteras automatiskt varje månad via Stripe.</p></div></div><div><span>F</span><div><strong>Fakturabetalning</strong><p>${escapeHtml(invoiceText)}</p></div>${invoiceAction}</div><div><span>A</span><div><strong>Svenskt Autogiro – tillval</strong><p>${escapeHtml(autogiroRequest?`Status: ${autogiroRequest.status}. Pris: ${autogiroPrice}.`:`Pris: ${autogiroPrice}. Procella lämnar offert innan aktivering.`)}</p></div>${autogiroAction}</div></div><div class="billing-footer"><p>${escapeHtml(status.text)} Raderingen omfattar lägenheter, rum, bilder, dokument, protokoll och meddelanden.</p>${canPay?`<button class="primary-button" data-billing-action="${hasCustomer?'portal':'checkout'}">${hasCustomer?'Hantera betalning':'Aktivera månadsbetalning'}</button>`:'<small>Kontakta föreningens styrelse för betalningsfrågor.</small>'}</div></article>`;
    container.querySelector('[data-billing-action]')?.addEventListener('click',event=>openBilling(event.currentTarget.dataset.billingAction,event.currentTarget));
    container.querySelector('[data-request-autogiro]')?.addEventListener('click',requestAutogiro);
    container.querySelector('[data-quote-autogiro]')?.addEventListener('click',showAutogiroQuote);
    container.querySelector('[data-request-invoice]')?.addEventListener('click',showInvoiceRequest);
    container.querySelector('[data-register-invoice]')?.addEventListener('click',showPaidInvoice);
  }

  function drawLock(){
    document.querySelector('#subscriptionLock')?.remove();
    if(!subscription||procellaRoles.includes(profile?.role)||hasAccess(subscription))return;
    const status=statusContent(subscription),lock=document.createElement('section');lock.id='subscriptionLock';lock.className='subscription-lock';
    lock.innerHTML=`<div><span class="lock-symbol">○</span><p class="eyebrow">PROCELLA OVK</p><h1>${escapeHtml(status.label)}</h1><p>${escapeHtml(status.text)}</p><div class="lock-price"><strong>${escapeHtml(priceLabel(subscription))}</strong><small>${subscription.apartment_count} lägenheter · betalning stoppar raderingen</small></div>${profile?.role==='board'?'<button class="primary-button" data-unlock>Aktivera månadsbetalning</button>':'<p class="lock-help">Kontakta styrelsen eller Procella för att öppna portalen igen.</p>'}</div>`;
    document.body.append(lock);lock.querySelector('[data-unlock]')?.addEventListener('click',event=>openBilling(subscription.stripe_customer_id?'portal':'checkout',event.currentTarget));
  }

  async function openBilling(action,button){
    const original=button.textContent;button.disabled=true;button.textContent='Öppnar säker betalning…';
    try{
      const functionName=action==='portal'?'create-portal':'create-checkout';
      const {data,error}=await window.procellaDb.functions.invoke(functionName,{body:{brf_id:subscription.brf_id}});
      if(error||!data?.url)throw error||new Error('Betalningslänken saknas');
      window.location.href=data.url;
    }catch(error){button.disabled=false;button.textContent=original;window.procellaApp.showToast(error.message||'Betalningen kunde inte öppnas');}
  }

  async function requestAutogiro(event){
    const button=event.currentTarget,original=button.textContent;button.disabled=true;button.textContent='Registrerar…';
    const {error}=await window.procellaDb.from('autogiro_requests').insert({brf_id:subscription.brf_id,requested_by:profile.id});
    if(error){button.disabled=false;button.textContent=original;window.procellaApp.showToast(error.message);return;}
    window.procellaApp.showToast('Förfrågan om Autogiro är registrerad');await loadSubscription(subscription.brf_id);
  }

  function showAutogiroQuote(){
    window.procellaApp.openModal(`<p class="eyebrow">AUTOGIRO-TILLVAL</p><h2 id="modalTitle">Prissätt Autogiro</h2><p class="subtitle">Kundpriset beräknas automatiskt som leverantörens verkliga månadskostnad plus 10 procent.</p><form id="autogiroQuoteForm"><div class="form-grid"><label class="full">Leverantör<input name="provider_name" required value="${escapeHtml(autogiroRequest.provider_name||'')}"></label><label class="full">Procella kostnad per månad, kr exkl. moms<input name="provider_cost" type="number" min="0" step="0.01" required value="${autogiroRequest.provider_cost_ore!=null?autogiroRequest.provider_cost_ore/100:''}"></label></div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button">Spara offert</button></div></form>`);
    document.querySelector('#autogiroQuoteForm').addEventListener('submit',saveAutogiroQuote);
  }
  async function saveAutogiroQuote(event){
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));
    const {error}=await window.procellaDb.from('autogiro_requests').update({provider_name:values.provider_name.trim(),provider_cost_ore:Math.round(Number(values.provider_cost)*100),markup_percent:10,status:'quoted'}).eq('id',autogiroRequest.id);
    if(error){window.procellaApp.showToast(error.message);return;}
    window.procellaApp.closeModal();window.procellaApp.showToast('Autogiro-offerten är sparad med 10 procent tillägg');await loadSubscription(subscription.brf_id);
  }

  function showInvoiceRequest(){
    window.procellaApp.openModal(`<p class="eyebrow">FAKTURABETALNING</p><h2 id="modalTitle">Begär månadsfaktura</h2><p class="subtitle">Varje månad betalas i förskott. Abonnemanget förlängs först när Procella registrerat betalningen.</p><form id="invoiceRequestForm"><div class="form-grid"><label class="full">E-post för faktura<input name="invoice_email" type="email" required value="${escapeHtml(profile.email||'')}"></label><label>Organisationsnummer<input name="organization_number" required></label><label>Er referens<input name="reference_text"></label></div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button">Skicka förfrågan</button></div></form>`);
    document.querySelector('#invoiceRequestForm').addEventListener('submit',saveInvoiceRequest);
  }
  async function saveInvoiceRequest(event){
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));
    const {error}=await window.procellaDb.from('invoice_payment_requests').insert({brf_id:subscription.brf_id,requested_by:profile.id,invoice_email:values.invoice_email.trim(),organization_number:values.organization_number.trim(),reference_text:values.reference_text.trim()||null});
    if(error){window.procellaApp.showToast(error.message);return;}
    window.procellaApp.closeModal();window.procellaApp.showToast('Fakturaförfrågan är skickad');await loadSubscription(subscription.brf_id);
  }
  function showPaidInvoice(){
    window.procellaApp.openModal(`<p class="eyebrow">FAKTURABETALNING</p><h2 id="modalTitle">Registrera betald faktura</h2><p class="subtitle">Betalningen aktiverar nästa månad i förskott.</p><form id="paidInvoiceForm"><div class="form-grid"><label class="full">Fakturanummer<input name="invoice_number" required></label></div><div class="modal-footer"><button type="button" class="secondary-button" onclick="closeModal()">Avbryt</button><button class="primary-button">Registrera betalning</button></div></form>`);
    document.querySelector('#paidInvoiceForm').addEventListener('submit',registerPaidInvoice);
  }
  async function registerPaidInvoice(event){
    event.preventDefault();const number=new FormData(event.target).get('invoice_number').trim();
    const {error}=await window.procellaDb.rpc('register_paid_invoice',{target_brf_id:subscription.brf_id,invoice_number:number});
    if(error){window.procellaApp.showToast(error.message);return;}
    window.procellaApp.closeModal();window.procellaApp.showToast('Fakturan är betald och en månad har aktiverats');await loadSubscription(subscription.brf_id);
  }

  window.addEventListener('procella:session',event=>{
    profile=event.detail.profile;
    if(profile.brf_id&&!procellaRoles.includes(profile.role))loadSubscription(profile.brf_id);
    const params=new URLSearchParams(location.search);
    if(params.get('payment')==='success')setTimeout(()=>window.procellaApp?.showToast('Betalningen är registrerad'),500);
  });
  window.addEventListener('procella:brf-loaded',event=>{context=event.detail;loadSubscription(context.brf.id);});
  window.addEventListener('procella:settings-rendered',drawSettings);
})();
