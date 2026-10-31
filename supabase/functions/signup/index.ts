// Creates a Leela account that is already confirmed, so no confirmation email is needed.
// Supabase's built-in email only reaches the project's own team, so a normal sign-up
// would fail for a partner or grandparent. Deploy with verify_jwt = false.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad_request" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40);

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ error: "invalid_email" }, 400);
  }
  if (password.length < 8 || password.length > 72) return reply({ error: "weak_password" }, 400);
  if (!name) return reply({ error: "name_required" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  let serviceKey: string | undefined;
  try {
    serviceKey = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
  } catch {
    serviceKey = undefined;
  }
  serviceKey ??= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ error: "server_not_configured" }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // At most 10 sign-ups per network per hour.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("attempted_at", since);
  if ((count ?? 0) >= 10) return reply({ error: "too_many_attempts" }, 429);
  await admin.from("signup_attempts").insert({ ip });

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    const code = (error as { code?: string }).code ?? "";
    if (code === "email_exists" || message.includes("already")) return reply({ error: "email_taken" }, 409);
    if (code === "weak_password" || message.includes("password")) return reply({ error: "weak_password" }, 400);
    console.error("createUser failed", error);
    return reply({ error: "signup_failed" }, 500);
  }

  return reply({ ok: true });
});
