// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function stripeStillActive(subscriptionId:string){
  const key=Deno.env.get('STRIPE_SECRET_KEY');
  if(!key||!subscriptionId)return false;
  const response=await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`,{headers:{Authorization:`Bearer ${key}`}});
  if(!response.ok)return false;
  const subscription=await response.json();
  return ['active','trialing'].includes(subscription.status);
}

async function listFiles(admin:any,bucket:string,path:string):Promise<string[]>{
  const result:string[]=[];
  const {data,error}=await admin.storage.from(bucket).list(path,{limit:1000});
  if(error)throw error;
  for(const item of data||[]){
    const full=path?`${path}/${item.name}`:item.name;
    if(item.id)result.push(full);else result.push(...await listFiles(admin,bucket,full));
  }
  return result;
}

Deno.serve(async request=>{
  if(request.headers.get('x-cron-secret')!==Deno.env.get('PURGE_CRON_SECRET'))return new Response('Unauthorized',{status:401});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now=new Date().toISOString();
  const {data:invoiceExpired}=await admin.from('brf_subscriptions').select('brf_id,current_period_ends_at').eq('payment_method','invoice').eq('status','active').lte('current_period_ends_at',now);
  for(const item of invoiceExpired||[])await admin.from('brf_subscriptions').update({status:'past_due',data_deletion_at:item.current_period_ends_at,updated_at:now}).eq('brf_id',item.brf_id);
  const {data:expired,error}=await admin.from('brf_subscriptions').select('brf_id,status,data_deletion_at,stripe_subscription_id,apartment_count').lte('data_deletion_at',now).neq('status','active');
  if(error)return new Response(error.message,{status:500});
  const deleted=[],failed=[];
  for(const item of expired||[]){
    try{
      if(await stripeStillActive(item.stripe_subscription_id)){
        await admin.from('brf_subscriptions').update({status:'active',data_deletion_at:null,updated_at:now}).eq('brf_id',item.brf_id);
        continue;
      }
      const {data:brf}=await admin.from('brfs').select('id,name,organization_number').eq('id',item.brf_id).maybeSingle();
      if(!brf)continue;
      const {data:profiles}=await admin.from('profiles').select('id').eq('brf_id',brf.id).in('role',['board','resident']);
      for(const bucket of ['ventilation-media','ovk-documents']){
        const files=await listFiles(admin,bucket,brf.id);
        for(let index=0;index<files.length;index+=100){
          const {error:removeError}=await admin.storage.from(bucket).remove(files.slice(index,index+100));
          if(removeError)throw removeError;
        }
      }
      await admin.from('purged_brfs').upsert({original_brf_id:brf.id,brf_name:brf.name,organization_number:brf.organization_number,apartment_count:item.apartment_count,reason:'Provperiod eller betalperiod avslutad utan aktiv betalning'},{onConflict:'original_brf_id'});
      const {error:deleteError}=await admin.from('brfs').delete().eq('id',brf.id);if(deleteError)throw deleteError;
      const profileIds=(profiles||[]).map(profile=>profile.id);
      if(profileIds.length)await admin.from('profiles').update({active:false}).in('id',profileIds);
      deleted.push(brf.id);
    }catch(error){console.error(item.brf_id,error);failed.push({brf_id:item.brf_id,error:String(error?.message||error)});}
  }
  return new Response(JSON.stringify({deleted,failed}),{headers:{'Content-Type':'application/json'}});
});
