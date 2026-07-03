// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

const chunks = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Inloggning saknas' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Ogiltig inloggning' }, 401);

    const { message_id: messageId } = await request.json();
    if (!messageId) return json({ error: 'message_id saknas' }, 400);

    const { data: message, error: messageError } = await admin.from('messages')
      .select('id,conversation_id,sender_id,body,created_at').eq('id', messageId).single();
    if (messageError || !message) return json({ error: 'Meddelandet hittades inte' }, 404);
    if (message.sender_id !== user.id) return json({ error: 'Du får inte skicka notiser för detta meddelande' }, 403);

    const [{ data: conversation, error: conversationError }, { data: sender, error: senderError }] = await Promise.all([
      admin.from('conversations').select('id,brf_id,apartment_id,subject,category,created_by').eq('id', message.conversation_id).single(),
      admin.from('profiles').select('id,email,full_name,role').eq('id', message.sender_id).single()
    ]);
    if (conversationError || !conversation) throw conversationError || new Error('Konversationen saknas');
    if (senderError || !sender) throw senderError || new Error('Avsändaren saknas');

    const { data: participantRows, error: participantError } = await admin.from('conversation_participants')
      .select('profile_id').eq('conversation_id', conversation.id);
    if (participantError) throw participantError;
    const recipientIds = new Set((participantRows || []).map(row => row.profile_id));

    // Frågor från boende ska alltid nå både föreningens styrelse och Procella.
    if (conversation.apartment_id) {
      const { data: staff, error: staffError } = await admin.from('profiles')
        .select('id,role,brf_id').eq('active', true)
        .in('role', ['procella_admin', 'procella_staff', 'board']);
      if (staffError) throw staffError;
      for (const profile of staff || []) {
        if (profile.role !== 'board' || profile.brf_id === conversation.brf_id) recipientIds.add(profile.id);
      }
    }
    recipientIds.delete(user.id);
    const ids = [...recipientIds];
    if (!ids.length) return json({ email: 0, push: 0, recipients: 0 });

    const [{ data: recipients, error: recipientError }, { data: preferences, error: preferenceError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      admin.from('profiles').select('id,email,full_name,active').in('id', ids).eq('active', true),
      admin.from('notification_preferences').select('profile_id,email_enabled,push_enabled').in('profile_id', ids),
      admin.from('push_subscriptions').select('id,profile_id,endpoint,p256dh,auth_key').in('profile_id', ids)
    ]);
    if (recipientError) throw recipientError;
    if (preferenceError) throw preferenceError;
    if (subscriptionError) throw subscriptionError;

    const preferenceMap = new Map((preferences || []).map(item => [item.profile_id, item]));
    const activeRecipients = recipients || [];
    const emailRecipients = activeRecipients.filter(profile => preferenceMap.get(profile.id)?.email_enabled !== false && profile.email);
    const pushProfileIds = new Set(activeRecipients.filter(profile => preferenceMap.get(profile.id)?.push_enabled === true).map(profile => profile.id));
    const pushSubscriptions = (subscriptions || []).filter(subscription => pushProfileIds.has(subscription.profile_id));
    const appUrl = Deno.env.get('APP_URL') || 'https://procellavent.se/';
    const messageUrl = `${appUrl.replace(/\/$/, '')}/#messages`;
    const senderName = sender.full_name || sender.email || 'Procella OVK';
    const deliveryRows: Array<Record<string, unknown>> = [];

    let emailSent = 0;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey && emailRecipients.length) {
      const from = Deno.env.get('EMAIL_FROM') || 'Procella OVK <notiser@procellavent.se>';
      const emails = emailRecipients.map(profile => ({
        from,
        to: [profile.email],
        subject: `Nytt meddelande: ${conversation.subject}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#173f37"><h2>Procella OVK</h2><p>Hej ${escapeHtml(profile.full_name || '')},</p><p><strong>${escapeHtml(senderName)}</strong> har skickat ett nytt meddelande.</p><div style="background:#f3f7f5;border-left:4px solid #9bbd23;padding:16px"><strong>${escapeHtml(conversation.subject)}</strong><p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p></div><p><a href="${escapeHtml(messageUrl)}" style="display:inline-block;background:#173f37;color:white;padding:11px 18px;text-decoration:none;border-radius:7px">Öppna meddelandet</a></p><p style="color:#687a74;font-size:12px">Procella Ventilation AB · procellavent.se</p></div>`
      }));

      for (const batch of chunks(emails, 100)) {
        const response = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(batch)
        });
        if (response.ok) emailSent += batch.length;
        const errorText = response.ok ? null : (await response.text()).slice(0, 500);
        for (const email of batch) {
          const profile = emailRecipients.find(item => item.email === email.to[0]);
          if (profile) deliveryRows.push({ message_id: message.id, profile_id: profile.id, channel: 'email', status: response.ok ? 'sent' : 'failed', error_message: errorText });
        }
      }
    } else {
      for (const profile of emailRecipients) deliveryRows.push({ message_id: message.id, profile_id: profile.id, channel: 'email', status: 'skipped', error_message: 'RESEND_API_KEY saknas' });
    }

    let pushSent = 0;
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    if (vapidPublic && vapidPrivate && pushSubscriptions.length) {
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:kewin.richert@procellavent.se', vapidPublic, vapidPrivate);
      await Promise.all(pushSubscriptions.map(async subscription => {
        try {
          await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } }, JSON.stringify({
            title: conversation.subject,
            body: `${senderName}: ${message.body.slice(0, 150)}`,
            url: messageUrl,
            conversationId: conversation.id
          }));
          pushSent += 1;
          deliveryRows.push({ message_id: message.id, profile_id: subscription.profile_id, channel: 'push', status: 'sent' });
        } catch (error) {
          const statusCode = Number(error?.statusCode || 0);
          if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', subscription.id);
          deliveryRows.push({ message_id: message.id, profile_id: subscription.profile_id, channel: 'push', status: 'failed', error_message: String(error?.message || error).slice(0, 500) });
        }
      }));
    }

    if (deliveryRows.length) await admin.from('notification_deliveries').insert(deliveryRows);
    return json({ email: emailSent, push: pushSent, recipients: activeRecipients.length });
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Notisen kunde inte skickas' }, 500);
  }
});
