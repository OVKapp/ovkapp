// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character] || character));

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Inloggning saknas' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Ogiltig inloggning' }, 401);
    const { invitation_id: invitationId } = await request.json();
    if (!invitationId) return json({ error: 'invitation_id saknas' }, 400);

    const [{ data: caller, error: callerError }, { data: invitation, error: invitationError }] = await Promise.all([
      admin.from('profiles').select('id,role,brf_id,full_name,email').eq('id', user.id).single(),
      admin.from('access_invitations').select('id,email,full_name,role,brf_id,apartment_id,invited_by,status').eq('id', invitationId).single()
    ]);
    if (callerError || !caller) return json({ error: 'Avsändaren saknas' }, 403);
    if (invitationError || !invitation) return json({ error: 'Inbjudan hittades inte' }, 404);
    const procella = ['procella_admin', 'procella_staff'].includes(caller.role);
    const allowedBoard = caller.role === 'board' && caller.brf_id === invitation.brf_id && invitation.role !== 'procella_staff';
    if ((!procella && !allowedBoard) || invitation.invited_by !== user.id) return json({ error: 'Du får inte skicka denna inbjudan' }, 403);
    if (invitation.status !== 'pending') return json({ error: 'Inbjudan är inte längre aktiv' }, 409);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY saknas i Supabase');
    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
    if (!appUrl) throw new Error('APP_URL saknas i Supabase');

    const { data: brf } = invitation.brf_id
      ? await admin.from('brfs').select('name').eq('id', invitation.brf_id).maybeSingle()
      : { data: null };
    const roleLabel = invitation.role === 'procella_staff' ? 'Procella-användare' : invitation.role === 'board' ? 'styrelsemedlem' : 'boende';
    const inviteUrl = `${appUrl}/?invite=1&email=${encodeURIComponent(invitation.email)}`;
    const senderName = caller.full_name || caller.email || 'Procella Ventilation AB';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') || 'Procella OVK <notiser@procellavent.se>',
        to: [invitation.email],
        subject: `Du är inbjuden till Procella OVK${brf?.name ? ` – ${brf.name}` : ''}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#173f37"><h2>Välkommen till Procella OVK</h2><p>Hej ${escapeHtml(invitation.full_name || '')},</p><p><strong>${escapeHtml(senderName)}</strong> har bjudit in dig som ${escapeHtml(roleLabel)}${brf?.name ? ` i <strong>${escapeHtml(brf.name)}</strong>` : ''}.</p><p>I portalen kan du se information om ventilation, OVK och meddelanden som gäller dig.</p><p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#173f37;color:white;padding:12px 19px;text-decoration:none;border-radius:7px">Skapa mitt konto</a></p><p style="color:#687a74;font-size:12px">Registrera dig med samma e-postadress som detta mejl skickades till. Du kan därefter behöva bekräfta adressen via ett separat mejl.</p><p style="color:#687a74;font-size:12px">Procella Ventilation AB · procellavent.se</p></div>`
      })
    });

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 500);
      await admin.from('access_invitations').update({ email_delivery_status: 'failed', email_delivery_error: errorText }).eq('id', invitation.id);
      return json({ error: errorText }, 502);
    }

    await admin.from('access_invitations').update({ email_sent_at: new Date().toISOString(), email_delivery_status: 'sent', email_delivery_error: null }).eq('id', invitation.id);
    return json({ sent: true });
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Inbjudningsmejlet kunde inte skickas' }, 500);
  }
});
