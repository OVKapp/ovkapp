// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const encoder=new TextEncoder();
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join('');
const safeEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;};
async function verify(raw:string,header:string,secret:string){
  const parts=Object.fromEntries(header.split(',').map(item=>item.split('=')));
  const timestamp=parts.t,signature=parts.v1;if(!timestamp||!signature)return false;
  if(Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${raw}`));
  return safeEqual(hex(digest),signature);
}
const fromUnix=(value:number|undefined)=>value?new Date(value*1000).toISOString():null;

Deno.serve(async request=>{
  const raw=await request.text(),signature=request.headers.get('stripe-signature')||'',secret=Deno.env.get('STRIPE_WEBHOOK_SECRET')||'';
  if(!secret||!await verify(raw,signature,secret))return new Response('Invalid signature',{status:400});
  try{
    const event=JSON.parse(raw),object=event.data.object;
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if(event.type==='checkout.session.completed'){
      const brfId=object.metadata?.brf_id||object.client_reference_id;
      await admin.from('brf_subscriptions').update({stripe_customer_id:object.customer,stripe_subscription_id:object.subscription,updated_at:new Date().toISOString()}).eq('brf_id',brfId);
    }
    if(event.type.startsWith('customer.subscription.')){
      const brfId=object.metadata?.brf_id;
      const item=object.items?.data?.[0];
      const status=object.status==='active'?'active':object.status==='trialing'?'trialing':object.status==='past_due'||object.status==='unpaid'?'past_due':object.status==='canceled'?'canceled':'paused';
      const periodEnd=fromUnix(object.current_period_end||item?.current_period_end);
      const deletionAt=['active','trialing'].includes(status)?null:(periodEnd||new Date().toISOString());
      if(brfId)await admin.from('brf_subscriptions').update({status,stripe_customer_id:object.customer,stripe_subscription_id:object.id,current_period_started_at:fromUnix(object.current_period_start||item?.current_period_start),current_period_ends_at:periodEnd,cancel_at_period_end:Boolean(object.cancel_at_period_end),data_deletion_at:deletionAt,updated_at:new Date().toISOString()}).eq('brf_id',brfId);
    }
    if(event.type==='invoice.payment_failed'&&object.subscription)await admin.from('brf_subscriptions').update({status:'past_due',updated_at:new Date().toISOString()}).eq('stripe_subscription_id',object.subscription);
    if(event.type==='invoice.paid'&&object.subscription&&Number(object.amount_paid)>0)await admin.from('brf_subscriptions').update({status:'active',data_deletion_at:null,updated_at:new Date().toISOString()}).eq('stripe_subscription_id',object.subscription);
    return new Response('ok',{status:200});
  }catch(error){console.error(error);return new Response('Webhook failed',{status:500});}
});
