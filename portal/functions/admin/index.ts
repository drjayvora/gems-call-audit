// Admin actions that need the service key: add a user, change their role, schools or access, remove them.
// Users sign in with a one-time code sent to their email, so adding someone needs no invite or password.
// Deploy: supabase functions deploy admin
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const ROLES = ["admin", "corporate", "principal", "counsellor"];
const DOMAIN = "@gemsedu.in";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Only an active admin may call this.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await sb.from("profiles").select("role, active").eq("id", user.id).single();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "Only an admin can do this." }, 403);

  const b = await req.json();
  try {
    if (b.action === "save_user") {
      const email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim();
      if (!email.endsWith(DOMAIN) || email.length <= DOMAIN.length) return json({ error: `Use a ${DOMAIN} email.` }, 400);
      if (!ROLES.includes(b.role)) return json({ error: "Pick a role." }, 400);
      if (b.id === user.id && (b.role !== "admin" || !b.active)) return json({ error: "You can't remove your own admin access." }, 400);
      let id = b.id;
      if (!id) {   // new user: they sign in with a code emailed to them, nothing to send now
        const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
        if (error) return json({ error: /already/i.test(error.message) ? "A user with this email already exists." : error.message }, 400);
        id = data.user.id;
      }
      const { error: pe } = await sb.from("profiles").upsert({ id, email, name, role: b.role, active: !!b.active });
      if (pe) throw pe;
      await sb.from("profile_schools").delete().eq("profile_id", id);
      const schools = b.role === "principal" ? (b.schools || []) : [];   // admin and corporate see every school, a counsellor only their own calls
      if (schools.length) { const { error } = await sb.from("profile_schools").insert(schools.map((s: string) => ({ profile_id: id, school_id: s }))); if (error) throw error; }
      await sb.auth.admin.updateUserById(id, { ban_duration: b.active ? "none" : "876000h" });   // switched off = can't sign in
      return json({ id, invited: !b.id });
    }
    if (b.action === "delete_user") {
      if (b.id === user.id) return json({ error: "You can't delete yourself." }, 400);
      const { error } = await sb.auth.admin.deleteUser(b.id);   // profile and school ticks go with it (on delete cascade)
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
