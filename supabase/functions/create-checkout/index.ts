// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:{...cors,'Content-Type':'application/json'}});

async function stripeRequest(path: string, values: Record<string,string>) {
  const body = new URLSearchParams(values);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method:'POST',
    headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,'Content-Type':'application/x-www-form-urlencoded'},
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe kunde inte skapa betalningen');
  return data;
}

Deno.serve(async request => {
  if(request.method==='OPTIONS') return new Response('ok',{headers:cors});
  try {
    const authorization=request.headers.get('Authorization');
    if(!authorization) return json({error:'Inloggning saknas'},401);
    if(!Deno.env.get('STRIPE_SECRET_KEY')) throw new Error('STRIPE_SECRET_KEY saknas');
    const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
    const admin=createClient(url,service);
    const {data:{user}}=await userClient.auth.getUser();
    if(!user) return json({error:'Ogiltig inloggning'},401);
    const {brf_id:brfId}=await request.json();
    const [{data:profile},{data:brf},{data:subscription}] = await Promise.all([
      admin.from('profiles').select('id,email,role,brf_id').eq('id',user.id).single(),
      admin.from('brfs').select('id,name').eq('id',brfId).single(),
      admin.from('brf_subscriptions').select('*').eq('brf_id',brfId).single()
    ]);
    const procella=['procella_admin','procella_staff'].includes(profile?.role);
    if(!profile || (!procella && !(profile.role==='board'&&profile.brf_id===brfId))) return json({error:'Du får inte starta detta abonnemang'},403);
    if(!brf||!subscription) return json({error:'Föreningen eller prisplanen saknas'},404);
    if(!subscription.monthly_price_ore) return json({error:'Föreningar med fler än 499 lägenheter får en personlig offert'},409);
    const taxRate=Deno.env.get('STRIPE_VAT_TAX_RATE_ID');
    if(!taxRate) throw new Error('STRIPE_VAT_TAX_RATE_ID saknas');
    const appUrl=(Deno.env.get('APP_URL')||'').replace(/\/$/,'');
    if(!appUrl) throw new Error('APP_URL saknas');

    const values:Record<string,string>={
      mode:'subscription',
      success_url:`${appUrl}/?payment=success#settings`,
      cancel_url:`${appUrl}/?payment=cancelled#settings`,
      client_reference_id:brf.id,
      'metadata[brf_id]':brf.id,
      'subscription_data[metadata][brf_id]':brf.id,
      'line_items[0][quantity]':'1',
      'line_items[0][price_data][currency]':'sek',
      'line_items[0][price_data][unit_amount]':String(subscription.monthly_price_ore),
      'line_items[0][price_data][recurring][interval]':'month',
      'line_items[0][price_data][tax_behavior]':'exclusive',
      'line_items[0][price_data][product_data][name]':`Procella OVK – ${brf.name}`,
      'line_items[0][price_data][product_data][description]':`${subscription.apartment_count} lägenheter · månadsabonnemang`,
      'line_items[0][tax_rates][0]':taxRate,
      billing_address_collection:'required',
      'tax_id_collection[enabled]':'true',
      locale:'sv'
    };
    if(subscription.stripe_customer_id) values.customer=subscription.stripe_customer_id;
    else values.customer_email=profile.email;
    const trialEnd=subscription.trial_ends_at?Math.floor(new Date(subscription.trial_ends_at).getTime()/1000):0;
    if(trialEnd>Math.floor(Date.now()/1000)+172800) values['subscription_data[trial_end]']=String(trialEnd);
    const session=await stripeRequest('checkout/sessions',values);
    return json({url:session.url});
  } catch(error) { console.error(error); return json({error:error?.message||'Betalningen kunde inte startas'},500); }
});
