// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const authorization=request.headers.get('Authorization');
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization||''}}}),admin=createClient(url,service);
    const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:'Ogiltig inloggning'},401);
    const {brf_id:brfId}=await request.json();
    const [{data:profile},{data:subscription}]=await Promise.all([admin.from('profiles').select('role,brf_id').eq('id',user.id).single(),admin.from('brf_subscriptions').select('stripe_customer_id').eq('brf_id',brfId).single()]);
    const procella=['procella_admin','procella_staff'].includes(profile?.role);
    if(!profile||(!procella&&!(profile.role==='board'&&profile.brf_id===brfId)))return json({error:'Åtkomst nekad'},403);
    if(!subscription?.stripe_customer_id)return json({error:'Det finns inget aktivt betalkonto'},409);
    const appUrl=(Deno.env.get('APP_URL')||'').replace(/\/$/,'');
    const body=new URLSearchParams({customer:subscription.stripe_customer_id,return_url:`${appUrl}/#settings`});
    const response=await fetch('https://api.stripe.com/v1/billing_portal/sessions',{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,'Content-Type':'application/x-www-form-urlencoded'},body});
    const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||'Kundportalen kunde inte öppnas');
    return json({url:data.url});
  }catch(error){console.error(error);return json({error:error?.message||'Kundportalen kunde inte öppnas'},500);}
});
