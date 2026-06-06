/**
 * Keyless end-to-end demo: drive the REAL reconciliation core against the REAL keyless simulator,
 * advancing `now` so a delayed flight visibly slips OK -> AT_RISK -> MISS_PREDICTED and fires a CATCH.
 *
 * Nothing here is a reimplementation: it imports the same `simulateFlight` (the zero-billing flight
 * source), `detectCollision` (the thesis core), and `step` (the state machine) that the cron tick
 * uses. The only thing we synthesize is the clock — exactly what the live demo needs to show lead time.
 *
 *   npx tsx scripts/demo-loop.ts [FLIGHTNUMBER] [YYYY-MM-DD]
 */
import { DateTime } from "luxon";
import { simulateFlight, scenarioFor } from "@/lib/adapters/simulator";
import { detectCollision } from "@/lib/engine/collision";
import { step } from "@/lib/engine/state";
import { ENGINE } from "@/lib/engine/constants";
import type { Commitment, FiredKind, WatchState } from "@/lib/engine/types";

const flightNumber = process.argv[2] ?? "BA286DLY";
const date = process.argv[3] ?? "2026-06-06";
const TRANSIT = 20; // minutes airport -> place (what U4 OSRM would return)
const EGRESS = ENGINE.egressMinutes;

const baseline = simulateFlight(flightNumber, date, `${date}T00:00:00Z`);
if (baseline.kind !== "ok") {
  console.error(`simulator returned ${baseline.kind} for ${flightNumber} ${date}`);
  process.exit(1);
}
const sched = DateTime.fromISO(baseline.data.scheduledUtc as string, { zone: "utc" });

// Commitment is set so the ON-TIME flight starts comfortably OK (+35m slack, outside the 20m
// AT_RISK band); the ramping delay is what walks it OK -> AT_RISK -> MISS. Zone UTC, wall-time =
// the commitment instant's UTC wall clock.
const commitInstant = sched.plus({ minutes: EGRESS + TRANSIT + 35 });
const commitment: Commitment = {
  localWallTime: commitInstant.toISO({ includeOffset: false }) as string,
  ianaZone: "UTC",
  marginMinutes: 0,
  reschedulable: false,
};

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\nKeeper — keyless end-to-end loop (simulator, no API key)`);
console.log(`flight ${flightNumber}  scenario=${scenarioFor(flightNumber)}  date ${date}`);
console.log(`scheduled arrival ${sched.toISO()}  |  commitment ${commitInstant.toISO()} (UTC)`);
console.log(`transit ${TRANSIT}m + egress ${EGRESS}m, margin 0\n`);
console.log(
  `${pad("now (UTC)", 18)} ${pad("predicted", 18)} ${pad("status", 10)} ${pad("slack", 7)} ${pad("state", 16)} fired`,
);
console.log("-".repeat(86));

// Tick from 4h before the slot to 30m after, tightening near the slot. Thread state + dwell.
const offsetsMin = [-240, -180, -150, -120, -90, -60, -40, -25, -10, 0, 15, 30];
let state: WatchState = "OK";
let recoveryProgress = 0;
const fires: { at: string; kind: FiredKind }[] = [];

for (const off of offsetsMin) {
  const now = sched.plus({ minutes: off });
  const nowUtc = now.toUTC().toISO({ suppressMilliseconds: true }) as string;
  const res = simulateFlight(flightNumber, date, nowUtc);
  if (res.kind !== "ok") continue;
  const f = res.data;

  const collision = detectCollision({
    predictedArrivalUtc: f.predictedUtc,
    egressMinutes: EGRESS,
    transitMinutes: TRANSIT,
    commitment,
    nowUtc,
  });

  const out = step({
    current: state,
    verdict: collision.verdict,
    slackMinutes: collision.slackMinutes,
    flightStatus: f.status,
    flightLanded: f.status === "landed" || f.actualUtc !== null,
    feedStale: false,
    commitmentPassed: now >= commitInstant,
    recoveryProgress,
  });
  state = out.next;
  recoveryProgress = out.recoveryProgress;
  if (out.fired) fires.push({ at: nowUtc, kind: out.fired });

  const slack = collision.slackMinutes === null ? "—" : `${collision.slackMinutes > 0 ? "+" : ""}${collision.slackMinutes}m`;
  const predicted = (f.predictedUtc ?? "—").slice(11, 16);
  console.log(
    `${pad(nowUtc.slice(11, 16) + " (" + (off >= 0 ? "+" : "") + off + "m)", 18)} ${pad(predicted, 18)} ${pad(f.status, 10)} ${pad(slack, 7)} ${pad(state, 16)} ${out.fired ? "🔔 " + out.fired : ""}`,
  );
}

console.log("-".repeat(86));
if (fires.length === 0) {
  console.log("\n❌ no catch fired — the delay never crossed the commitment boundary for these parameters.\n");
  process.exit(2);
}
for (const fire of fires) console.log(`\n✅ CATCH fired: ${fire.kind} at ${fire.at} — pushed with lead time before the slot.`);
console.log();
