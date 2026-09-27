import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/adminAuth";

// Admin DB connectivity check using the service role key.
// The test lab page can't use supabaseServer (client component), so it calls this route instead.
// Not covered by proxy.ts's /admin/* cookie check — see app/api/admin/stats/route.ts.
export async function GET(req: NextRequest) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  // `detail` is a fixed string rather than the driver's own message. The reason
  // this endpoint exists is to answer "can the server reach the database", and
  // a boolean answers that; the Postgres text behind it names tables, columns
  // and occasionally the key prefix. It is logged instead, which is where an
  // operator reads it anyway. Status semantics are unchanged: both failures
  // still answer 200 with ok:false, as the caller expects.
  try {
    const { error } = await supabaseServer.from("users").select("id").limit(1);
    if (error) {
      console.error("[Admin] DB check failed:", error.message);
      return NextResponse.json({ ok: false, detail: "Database check failed." });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[Admin] DB check threw:", e);
    return NextResponse.json({ ok: false, detail: "Database check failed." });
  }
}
