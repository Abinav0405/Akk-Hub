import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, serviceKey, { db: { schema: 'materials' } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return reply(401, { error: 'Missing authenticated session' });
    // Pass JWT explicitly (same pattern as att-/prg-register-device-token). Relying only on
    // global Authorization headers makes getUser() fail with "Invalid session" for some clients.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
    if (userError || !userData.user) return reply(401, { error: 'Invalid session' });

    const { data: caller } = await admin
      .from('staff_profiles')
      .select('user_id, role, roles, is_active')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    const callerRoles = caller?.roles?.length ? caller.roles : [caller?.role];
    if (!caller?.is_active || !callerRoles.includes('admin')) {
      return reply(403, { error: 'Admin access required' });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    if (action === 'list') {
      const { data, error } = await admin
        .from('staff_profiles')
        .select('user_id, display_name, email, role, roles, is_active, created_at, updated_at')
        .contains('roles', ['manager'])
        .order('display_name');
      if (error) throw error;
      return reply(200, { managers: data || [] });
    }

    const displayName = String(body.display_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    let targetId = String(body.user_id || '');
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;

    if (action === 'create') {
      if (!displayName || !email) {
        return reply(400, { error: 'Name and email are required' });
      }
      const { data: existingProfile, error: existingError } = await admin
        .from('staff_profiles')
        .select('*')
        .ilike('email', email)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existingProfile) {
        targetId = existingProfile.user_id;
        before = existingProfile;
        const roles = [...new Set([...(existingProfile.roles || [existingProfile.role]), 'manager'])];
        if (password && password.length < 8) return reply(400, { error: 'Password must be at least 8 characters' });
        // Re-adding a removed manager: "delete" banned the sign-in, so lift the ban as well.
        const { error: authError } = await admin.auth.admin.updateUserById(targetId, {
          ban_duration: 'none',
          ...(password ? { password } : {}),
        });
        if (authError) throw authError;
        const { data, error } = await admin
          .from('staff_profiles')
          .update({ display_name: displayName, roles, is_active: true, updated_at: new Date().toISOString() })
          .eq('user_id', targetId)
          .select()
          .single();
        if (error) throw error;
        after = data;
      } else {
        if (password.length < 8) {
          return reply(400, { error: 'A password of at least 8 characters is required for a new account' });
        }
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: displayName, role: 'manager' },
        });
        if (error) throw error;
        targetId = created.user.id;
        const { data, error: profileError } = await admin
          .from('staff_profiles')
          .insert({
            user_id: targetId,
            display_name: displayName,
            email,
            role: 'manager',
            roles: ['manager'],
            is_active: true,
          })
          .select()
          .single();
        if (profileError) {
          await admin.auth.admin.deleteUser(targetId);
          throw profileError;
        }
        after = data;
      }
    } else {
      const { data: existing } = await admin
        .from('staff_profiles')
        .select('*')
        .eq('user_id', targetId)
        .contains('roles', ['manager'])
        .maybeSingle();
      if (!existing) return reply(404, { error: 'Manager not found' });
      before = existing;

      if (action === 'update') {
        if (!displayName || !email) return reply(400, { error: 'Name and email are required' });
        const attributes: Record<string, unknown> = {
          email,
          email_confirm: true,
          user_metadata: { display_name: displayName, role: 'manager' },
        };
        if (password) {
          if (password.length < 8) return reply(400, { error: 'Password must be at least 8 characters' });
          attributes.password = password;
        }
        const { error } = await admin.auth.admin.updateUserById(targetId, attributes);
        if (error) throw error;
        const { data, error: profileError } = await admin
          .from('staff_profiles')
          .update({ display_name: displayName, email, updated_at: new Date().toISOString() })
          .eq('user_id', targetId)
          .select()
          .single();
        if (profileError) throw profileError;
        after = data;
      } else if (action === 'grant_admin') {
        const existingRoles = existing.roles?.length ? existing.roles : [existing.role];
        if (existingRoles.includes('admin')) {
          return reply(400, { error: 'This account already has Admin access' });
        }
        const { data, error } = await admin
          .from('staff_profiles')
          .update({
            roles: [...existingRoles, 'admin'],
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', targetId)
          .select()
          .single();
        if (error) throw error;
        after = data;
      } else if (action === 'remove_admin') {
        const existingRoles = existing.roles?.length ? existing.roles : [existing.role];
        if (!existingRoles.includes('admin')) {
          return reply(400, { error: 'This account does not have Admin access' });
        }
        if (targetId === caller.user_id) {
          return reply(400, { error: 'You cannot remove your own Admin access' });
        }
        const { count, error: countError } = await admin
          .from('staff_profiles')
          .select('user_id', { count: 'exact', head: true })
          .contains('roles', ['admin'])
          .eq('is_active', true);
        if (countError) throw countError;
        if ((count || 0) <= 1) {
          return reply(400, { error: 'The final active administrator cannot be removed' });
        }
        const { data, error } = await admin
          .from('staff_profiles')
          .update({
            role: 'manager',
            roles: existingRoles.filter((role: string) => role !== 'admin'),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', targetId)
          .select()
          .single();
        if (error) throw error;
        after = data;
      } else if (action === 'delete') {
        const existingRoles = existing.roles?.length ? existing.roles : [existing.role];
        if (existingRoles.includes('admin')) {
          const { data, error } = await admin
            .from('staff_profiles')
            .update({ roles: existingRoles.filter((role: string) => role !== 'manager'), updated_at: new Date().toISOString() })
            .eq('user_id', targetId)
            .select()
            .single();
          if (error) throw error;
          after = data;
        } else {
          const { error } = await admin.auth.admin.updateUserById(targetId, {
            ban_duration: '876000h',
          });
          if (error) throw error;
          const { data, error: profileError } = await admin
            .from('staff_profiles')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('user_id', targetId)
            .select()
            .single();
          if (profileError) throw profileError;
          after = data;
        }
      } else {
        return reply(400, { error: 'Unknown action' });
      }
    }

    await admin.from('staff_activity').insert({
      actor_id: caller.user_id,
      actor_role: 'admin',
      action: action === 'remove_admin'
        ? 'manager_admin_access_removed'
        : action === 'grant_admin'
          ? 'manager_admin_access_granted'
          : `manager_${action}d`,
      entity_type: 'manager',
      entity_id: targetId,
      summary: `${action === 'delete' ? 'Deleted' : action === 'create' ? 'Created' : action === 'remove_admin' ? 'Removed Admin access from' : action === 'grant_admin' ? 'Granted Admin access to' : 'Updated'} manager ${displayName || before?.display_name || ''}`,
      before_data: before,
      after_data: after,
    });

    return reply(200, { ok: true, manager: after });
  } catch (error) {
    console.error('manage-staff error', error);
    return reply(500, { error: error instanceof Error ? error.message : 'Internal error' });
  }
});
