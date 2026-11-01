// Temporary backend check for Leela: two signed-in family members and a stranger, talking to the
// real database and Realtime exactly the way the app does. Run once from SQL, then disabled.
import { createClient, type RealtimeChannel, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const key = (name: string) => {
  try {
    return JSON.parse(Deno.env.get(name) ?? "{}").default as string | undefined;
  } catch {
    return undefined;
  }
};
const PUB = key("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SECRET = key("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Set to the SHA-256 of a fresh random token before deploying; send the token in x-check-token.
const TOKEN_HASH = "REPLACE_WITH_SHA256_OF_TOKEN";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Msg = { at: number; table: string; type: string; row: Record<string, any> };
type Result = { check: string; pass: boolean; ms?: number | null; note?: string };

const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email: string, name: string, password: string): Promise<string> {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email === email);
    if (u) {
      const { error: e2 } = await admin.auth.admin.updateUserById(u.id, { password });
      if (e2) throw e2;
      return u.id;
    }
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error) throw error;
  return data.user.id;
}

async function signIn(email: string, password: string) {
  const c = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  await c.realtime.setAuth(data.session!.access_token);
  return c;
}

function listen(c: SupabaseClient, familyId: string, label: string, inbox: Msg[]): Promise<RealtimeChannel> {
  const filter = `family_id=eq.${familyId}`;
  const push = (table: string) => (p: any) => inbox.push({ at: Date.now(), table, type: p.eventType, row: p.new ?? {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: realtime did not subscribe in 15s`)), 15000);
    const ch = c
      .channel(`family:${familyId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter }, push("events"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events", filter }, push("events"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "timer_segments", filter }, push("timer_segments"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "timer_segments", filter }, push("timer_segments"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "children", filter }, push("children"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "children", filter }, push("children"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "families", filter: `id=eq.${familyId}` }, push("families"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, push("profiles"))
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(ch);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`${label}: realtime ${status} ${err?.message ?? ""}`));
        }
      });
  });
}

async function waitFor(inbox: Msg[], pred: (m: Msg) => boolean, ms = 8000): Promise<Msg | null> {
  const end = Date.now() + ms;
  for (;;) {
    const m = inbox.find(pred);
    if (m) return m;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-check-token") ?? "";
  if (!token || (await sha256(token)) !== TOKEN_HASH) return new Response("not found", { status: 404 });

  const results: Result[] = [];
  const ok = (check: string, pass: boolean, ms?: number | null, note?: string) => results.push({ check, pass, ms, note });
  const channels: [SupabaseClient, RealtimeChannel][] = [];

  try {
    const pw = () => "chk-" + crypto.randomUUID();
    const pMom = pw(), pDad = pw(), pStr = pw();
    const momId = await ensureUser("check-mom@leela.test", "Check Mom", pMom);
    const dadId = await ensureUser("check-dad@leela.test", "Check Dad", pDad);
    await ensureUser("check-stranger@leela.test", "Check Stranger", pStr);
    const mom = await signIn("check-mom@leela.test", pMom);
    const dad = await signIn("check-dad@leela.test", pDad);
    const stranger = await signIn("check-stranger@leela.test", pStr);

    // Family, baby and second member (reused across runs).
    let familyId: string | undefined = (await mom.from("family_members").select("family_id").eq("user_id", momId).maybeSingle()).data?.family_id;
    if (!familyId) {
      const { data, error } = await mom.rpc("create_family", { p_family_name: "Leela check family", p_display_name: "Check Mom", p_timezone: "Asia/Kolkata" });
      if (error || !data?.ok) throw new Error(`create_family: ${error?.message ?? JSON.stringify(data)}`);
      familyId = data.family_id;
    }
    const fam = (await mom.from("families").select("*").eq("id", familyId!).single()).data!;
    let childId: string | undefined = (await mom.from("children").select("id").eq("family_id", familyId!).is("deleted_at", null).limit(1)).data?.[0]?.id;
    if (!childId) {
      childId = crypto.randomUUID();
      const { error } = await mom.from("children").insert({ id: childId, family_id: familyId, name: "Check baby", birth_date: iso(Date.now() - 100 * 86400000).slice(0, 10) });
      if (error) throw new Error(`add child: ${error.message}`);
    }
    const dadIn = (await dad.from("family_members").select("family_id").eq("user_id", dadId).maybeSingle()).data;
    if (!dadIn) {
      const wrong = await dad.rpc("join_family", { p_code: "LEELA-ZZZZ-ZZZZ", p_display_name: "Check Dad", p_confirm: false });
      ok("Wrong family code is refused", wrong.data?.ok === false && wrong.data?.error === "invalid_code", null, JSON.stringify(wrong.data ?? wrong.error));
      const { data, error } = await dad.rpc("join_family", { p_code: fam.code.toLowerCase(), p_display_name: "Check Dad", p_confirm: true });
      if (error || !data?.ok) throw new Error(`join_family: ${error?.message ?? JSON.stringify(data)}`);
    }

    // Clear timers left over from earlier runs.
    const leftovers = (await mom.from("events").select("id").eq("family_id", familyId!).not("timer_state", "is", null)).data ?? [];
    for (const r of leftovers) await mom.rpc("timer_stop", { p_event_id: r.id, p_at: iso() });

    const momBox: Msg[] = [], dadBox: Msg[] = [], strBox: Msg[] = [];
    const t0sub = Date.now();
    channels.push([mom, await listen(mom, familyId!, "mom", momBox)]);
    channels.push([dad, await listen(dad, familyId!, "dad", dadBox)]);
    channels.push([stranger, await listen(stranger, familyId!, "stranger", strBox)]);
    ok("Realtime subscriptions connect", true, Date.now() - t0sub);
    await sleep(1500);

    // 1. A diaper logged by Mom reaches Dad live.
    const diaper = crypto.randomUUID();
    const diaperRow = { id: diaper, family_id: familyId, child_id: childId, type: "diaper", started_at: iso(), data: { kind: "wet" } };
    let t = Date.now();
    const ins = await mom.from("events").upsert(diaperRow, { onConflict: "id", ignoreDuplicates: true });
    let got = await waitFor(dadBox, (m) => m.table === "events" && m.row.id === diaper);
    ok("Diaper from Mom appears on Dad's phone", !ins.error && !!got, got ? got.at - t : null, ins.error?.message);
    ok("Server stamps who logged it", got?.row.created_by === momId, null, `created_by ${got?.row.created_by}`);

    // 2. Replaying the same change (offline outbox) never duplicates it.
    const again = await mom.from("events").upsert(diaperRow, { onConflict: "id", ignoreDuplicates: true });
    await sleep(1500);
    const copies = (await dad.from("events").select("id").eq("id", diaper)).data?.length;
    const dupMsgs = dadBox.filter((m) => m.table === "events" && m.row.id === diaper && m.type === "INSERT").length;
    ok("Replayed change is ignored, no duplicate", !again.error && copies === 1 && dupMsgs === 1, null, `rows ${copies}, inserts seen ${dupMsgs}`);

    // 3. Mom starts a sleep timer, Dad sees it and stops it, Mom sees it end.
    const sleepId = crypto.randomUUID();
    t = Date.now();
    const s1 = await mom.from("events").upsert({ id: sleepId, family_id: familyId, child_id: childId, type: "sleep", started_at: iso(), timer_state: "running", data: {} }, { onConflict: "id", ignoreDuplicates: true });
    got = await waitFor(dadBox, (m) => m.table === "events" && m.row.id === sleepId && m.row.timer_state === "running");
    ok("Sleep timer started by Mom shows on Dad's phone", !s1.error && !!got, got ? got.at - t : null, s1.error?.message);
    await sleep(1200);
    t = Date.now();
    const stop = await dad.rpc("timer_stop", { p_event_id: sleepId, p_at: iso() });
    got = await waitFor(momBox, (m) => m.table === "events" && m.row.id === sleepId && m.row.timer_state === null && !!m.row.ended_at);
    ok("Dad stops it and Mom's timer ends", !stop.error && !!got, got ? got.at - t : null, stop.error?.message);
    const dur = got ? Date.parse(got.row.ended_at) - Date.parse(got.row.started_at) : -1;
    ok("Stopped sleep keeps the right length", dur >= 1000 && dur < 10000, null, `${dur} ms`);

    // 4. Both press Sleep at the same moment: exactly one timer survives.
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const [ra, rb] = await Promise.all([
      mom.from("events").upsert({ id: a, family_id: familyId, child_id: childId, type: "sleep", started_at: iso(), timer_state: "running", data: {} }, { onConflict: "id", ignoreDuplicates: true }),
      dad.from("events").upsert({ id: b, family_id: familyId, child_id: childId, type: "sleep", started_at: iso(), timer_state: "running", data: {} }, { onConflict: "id", ignoreDuplicates: true }),
    ]);
    const losers = [ra.error?.code, rb.error?.code].filter((c) => c === "23505").length;
    const runningNow = (await mom.from("events").select("id").eq("family_id", familyId!).eq("type", "sleep").not("timer_state", "is", null)).data ?? [];
    ok("Simultaneous starts leave exactly one timer", losers === 1 && runningNow.length === 1, null, `errors ${ra.error?.code ?? "-"}/${rb.error?.code ?? "-"}, running ${runningNow.length}`);
    for (const r of runningNow) await mom.rpc("timer_stop", { p_event_id: r.id, p_at: iso() });

    // 5. Breastfeeding with sides: switching and stopping, seen live by Dad.
    const feed = crypto.randomUUID(), segL = crypto.randomUUID(), segR = crypto.randomUUID();
    const startMs = Date.now();
    await mom.from("events").upsert({ id: feed, family_id: familyId, child_id: childId, type: "nursing", started_at: iso(startMs), timer_state: "running", data: { last_side: "left" } }, { onConflict: "id", ignoreDuplicates: true });
    t = Date.now();
    const segIns = await mom.from("timer_segments").upsert({ id: segL, event_id: feed, family_id: familyId, side: "left", started_at: iso(startMs) }, { onConflict: "id", ignoreDuplicates: true });
    got = await waitFor(dadBox, (m) => m.table === "timer_segments" && m.row.id === segL);
    ok("Breastfeeding side appears on Dad's phone", !segIns.error && !!got, got ? got.at - t : null, segIns.error?.message);
    await sleep(2000);
    t = Date.now();
    const sw = await mom.rpc("nursing_set", { p_event_id: feed, p_side: "right", p_at: iso(), p_segment_id: segR });
    const gotR = await waitFor(dadBox, (m) => m.table === "timer_segments" && m.row.id === segR);
    const gotLend = await waitFor(dadBox, (m) => m.table === "timer_segments" && m.row.id === segL && !!m.row.ended_at);
    ok("Switching sides reaches Dad", !sw.error && !!gotR && !!gotLend, gotR ? gotR.at - t : null, sw.error?.message);
    const sw2 = await mom.rpc("nursing_set", { p_event_id: feed, p_side: "right", p_at: iso(), p_segment_id: segR });
    const rCount = (await dad.from("timer_segments").select("id").eq("event_id", feed)).data?.length;
    ok("A replayed side switch is ignored", !sw2.error && rCount === 2, null, `segments ${rCount}`);
    await sleep(1000);
    t = Date.now();
    await mom.rpc("timer_stop", { p_event_id: feed, p_at: iso() });
    got = await waitFor(dadBox, (m) => m.table === "events" && m.row.id === feed && !!m.row.ended_at);
    const l = got?.row.data?.left_s, r = got?.row.data?.right_s;
    ok("Feed ends on Dad's phone with left and right minutes", !!got && l >= 1 && l <= 4 && r >= 0 && r <= 3, got ? got.at - t : null, `left ${l}s, right ${r}s`);

    // 6. Delete and Undo.
    t = Date.now();
    await mom.from("events").update({ deleted_at: iso() }).eq("id", diaper);
    got = await waitFor(dadBox, (m) => m.table === "events" && m.row.id === diaper && !!m.row.deleted_at);
    ok("Delete disappears on Dad's phone", !!got, got ? got.at - t : null);
    t = Date.now();
    await mom.from("events").update({ deleted_at: null }).eq("id", diaper);
    got = await waitFor(dadBox, (m) => m.table === "events" && m.row.id === diaper && m.row.deleted_at === null && m.at > t);
    ok("Undo brings it back on Dad's phone", !!got, got ? got.at - t : null);

    // 7. Two people edit the same entry: the stale edit is caught.
    const before = (await dad.from("events").select("updated_at").eq("id", diaper).single()).data!.updated_at;
    await mom.from("events").update({ notes: "Edited by Mom" }).eq("id", diaper);
    const stale = await dad.from("events").update({ notes: "Edited by Dad" }).eq("id", diaper).eq("updated_at", before).select("*");
    const kept = (await dad.from("events").select("notes").eq("id", diaper).single()).data?.notes;
    ok("Conflicting edit is detected, not overwritten", !stale.error && stale.data?.length === 0 && kept === "Edited by Mom", null, `rows ${stale.data?.length}, notes "${kept}"`);

    // 8. Backdated entry keeps its date.
    const bottle = crypto.randomUUID();
    const twoDaysAgo = iso(Date.now() - 2 * 86400000);
    t = Date.now();
    await dad.from("events").upsert({ id: bottle, family_id: familyId, child_id: childId, type: "bottle", started_at: twoDaysAgo, data: { amount_ml: 90, contents: "formula" } }, { onConflict: "id", ignoreDuplicates: true });
    got = await waitFor(momBox, (m) => m.table === "events" && m.row.id === bottle);
    ok("Backdated bottle reaches Mom with its date", !!got && Date.parse(got.row.started_at) === Date.parse(twoDaysAgo), got ? got.at - t : null);

    // 9. Family settings, baby details and names sync too.
    const night = fam.night_start?.startsWith("19:00") ? "19:30" : "19:00";
    t = Date.now();
    const famUp = await mom.from("families").update({ night_start: night }).eq("id", familyId!);
    got = await waitFor(dadBox, (m) => m.table === "families" && String(m.row.night_start).startsWith(night));
    ok("Night window change reaches Dad", !famUp.error && !!got, got ? got.at - t : null, famUp.error?.message);
    const codeUp = await mom.from("families").update({ code: "LEELA-AAAA-AAAA" } as never).eq("id", familyId!);
    ok("Family code can't be changed directly", !!codeUp.error, null, codeUp.error?.message);
    t = Date.now();
    const kidName = "Check baby " + new Date().getSeconds();
    await mom.from("children").update({ name: kidName }).eq("id", childId!);
    got = await waitFor(dadBox, (m) => m.table === "children" && m.row.name === kidName);
    ok("Baby's details reach Dad", !!got, got ? got.at - t : null);
    t = Date.now();
    const myName = "Check Mom " + new Date().getSeconds();
    await mom.from("profiles").update({ display_name: myName }).eq("id", momId);
    got = await waitFor(dadBox, (m) => m.table === "profiles" && m.row.display_name === myName);
    ok("Name change reaches Dad", !!got, got ? got.at - t : null);

    // 10. Someone outside the family sees and changes nothing.
    await sleep(1500);
    const peek = (await stranger.from("events").select("id").eq("family_id", familyId!)).data?.length ?? 0;
    const sneak = await stranger.from("events").insert({ id: crypto.randomUUID(), family_id: familyId, child_id: childId, type: "note", started_at: iso(), data: {} });
    const strangerProfileMsgs = strBox.filter((m) => m.table !== "profiles").length;
    ok("Stranger receives no live updates", strangerProfileMsgs === 0, null, `${strangerProfileMsgs} messages`);
    ok("Stranger can't read the family's entries", peek === 0, null, `${peek} rows`);
    ok("Stranger can't add entries", !!sneak.error, null, sneak.error?.message);
    const strangerProfiles = strBox.filter((m) => m.table === "profiles").length;
    ok("Stranger doesn't see family names change", strangerProfiles === 0, null, `${strangerProfiles} messages`);

    // Tidy up: hide this run's entries from the check family.
    for (const id of [diaper, sleepId, feed, bottle, a, b]) await mom.from("events").update({ deleted_at: iso() }).eq("id", id).is("deleted_at", null);
  } catch (e) {
    ok("Run finished", false, null, e instanceof Error ? e.message : String(e));
  } finally {
    for (const [c, ch] of channels) await c.removeChannel(ch);
  }

  const latencies = results.filter((r) => typeof r.ms === "number" && r.check !== "Realtime subscriptions connect").map((r) => r.ms as number);
  const summary = {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    live_ms: latencies.length ? { min: Math.min(...latencies), max: Math.max(...latencies), avg: Math.round(latencies.reduce((x, y) => x + y, 0) / latencies.length) } : null,
    region: Deno.env.get("SB_REGION"),
  };
  return new Response(JSON.stringify({ summary, results }, null, 1), { headers: { "Content-Type": "application/json" } });
});
