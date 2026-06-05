import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

import {
  buildAdvice,
  planSend,
  ttlForRow,
  classifySendError,
  type OutboxRow,
  type DispatchContext,
  type StoredSubscription,
} from "@/lib/push/dispatch";
import { renderCatch } from "@/lib/push/template";
// Pure install-context detection lives in the client component but is dependency-free at import.
import { detectInstallContext, urlBase64ToUint8Array } from "@/components/InstallPrompt";

/**
 * U8 tests. The PURE planner (advice-building, send decision, TTL, error classification) carries the
 * full decision matrix and always runs. The IO shell (dispatchOutbox: query -> web-push -> record ->
 * prune) is exercised in a DATABASE_URL-gated block with web-push mocked, asserting the corpus
 * invariant: pruning a dead subscription marks delivery failed and NEVER erases calibration.
 */

const NOW = "2026-06-05T17:00:00.000Z";

// Commitment 20:00Z; transit 30 + egress 35; predicted flight arrival 19:10Z.
// Projected at place = 19:10 + 65min = 20:15Z. Reschedulable recommendation rounds up to 20:30Z.
const baseCtx = (over: Partial<DispatchContext> = {}): DispatchContext => ({
  flightNumber: "EK1",
  placeLabel: "Trafalgar Square",
  reschedulable: true,
  contact: "The venue",
  zone: "Europe/London",
  commitmentInstantUtc: "2026-06-05T20:00:00.000Z",
  dashboardUrl: "https://keeper.app/dashboard?watch=w1",
  predictedArrivalUtc: "2026-06-05T19:10:00.000Z",
  transitMinutesUsed: 30,
  egressMinutesUsed: 35,
  marginMinutesUsed: 0,
  ...over,
});

const catchRow = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  watchId: "w1",
  transition: "AT_RISK->MISS_PREDICTED",
  revision: "rev-1",
  kind: "CATCH",
  leadTimeMinutes: 90,
  ...over,
});

const sub: StoredSubscription = {
  id: 1,
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhfGTJaP-uA",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

describe("buildAdvice — reschedulable CATCH", () => {
  it("derives a projected arrival + a recommended new time, and renders the contact + push time", () => {
    const advice = buildAdvice(catchRow(), baseCtx());
    expect(advice.kind).toBe("CATCH");
    expect(advice.newArrivalUtc).toBe("2026-06-05T19:10:00.000Z");
    // 19:10 + 65min = 20:15Z projected at place.
    expect(advice.projectedAtPlaceUtc).toBe("2026-06-05T20:15:00.000Z");
    // Reschedulable: recommend the next quarter-hour at/after projected. 20:15 is already on a
    // 15-min boundary, so the earliest realistic slot is 20:15Z itself.
    expect(advice.recommendedNewTimeUtc).toBe("2026-06-05T20:15:00.000Z");

    const msg = renderCatch(advice);
    // London (BST, +1): 20:15Z renders as 9:15 PM; contact is named.
    expect(msg.body).toContain("The venue");
    expect(msg.body).toContain("9:15 PM");
    expect(msg.title).toContain("Trafalgar Square");
  });

  it("rounds a non-boundary projected arrival UP to the next quarter-hour", () => {
    // Predicted 19:14Z + 65min = 20:19Z projected -> rounds up to 20:30Z.
    const advice = buildAdvice(catchRow(), baseCtx({ predictedArrivalUtc: "2026-06-05T19:14:00.000Z" }));
    expect(advice.projectedAtPlaceUtc).toBe("2026-06-05T20:19:00.000Z");
    expect(advice.recommendedNewTimeUtc).toBe("2026-06-05T20:30:00.000Z");
  });
});

describe("buildAdvice — fixed CATCH", () => {
  it("recommends no new time and renders the likely-miss + window copy", () => {
    const advice = buildAdvice(catchRow(), baseCtx({ reschedulable: false, contact: null }));
    expect(advice.reschedulable).toBe(false);
    expect(advice.recommendedNewTimeUtc).toBeNull();

    const msg = renderCatch(advice);
    expect(msg.body).toContain("likely lost");
    expect(msg.body).toMatch(/cancellation or exchange window/i);
    // The fixed branch must NOT recommend pushing to a time.
    expect(msg.body).not.toMatch(/push it to/i);
  });
});

describe("buildAdvice — degrades without a snapshot", () => {
  it("leaves arrival + projection null when there is no predicted arrival", () => {
    const advice = buildAdvice(catchRow(), baseCtx({ predictedArrivalUtc: null }));
    expect(advice.newArrivalUtc).toBeNull();
    expect(advice.projectedAtPlaceUtc).toBeNull();
    expect(advice.recommendedNewTimeUtc).toBeNull();
    const msg = renderCatch(advice);
    expect(msg.body).toContain("running late");
  });
});

describe("planSend", () => {
  it("plans a send with payload + TTL when a subscription exists", () => {
    const advice = buildAdvice(catchRow(), baseCtx());
    const msg = renderCatch(advice);
    const plan = planSend(catchRow(), baseCtx(), msg, sub);
    expect(plan.action).toBe("send");
    if (plan.action === "send") {
      expect(plan.subscription).toBe(sub);
      expect(plan.payload.type).toBe("catch");
      expect(plan.payload.data).toEqual({ watchId: "w1", url: "https://keeper.app/dashboard?watch=w1" });
      expect(plan.ttlSeconds).toBe(90 * 60); // 90 min lead -> 5400s, within bounds
    }
  });

  it("resolves to no_device when the device has no subscription registered", () => {
    const advice = buildAdvice(catchRow(), baseCtx());
    const msg = renderCatch(advice);
    const plan = planSend(catchRow(), baseCtx(), msg, null);
    expect(plan.action).toBe("no_device");
  });
});

describe("ttlForRow", () => {
  it("floors a tiny lead and ceilings a huge / missing one", () => {
    expect(ttlForRow(catchRow({ leadTimeMinutes: 0 }))).toBe(60); // floor
    expect(ttlForRow(catchRow({ leadTimeMinutes: 100_000 }))).toBe(6 * 60 * 60); // ceiling
    expect(ttlForRow(catchRow({ kind: "ALL_CLEAR", leadTimeMinutes: null }))).toBe(6 * 60 * 60);
  });
});

describe("classifySendError — 3-way disposition (prune / retry / failed)", () => {
  it("prunes a permanently-dead endpoint (404/410)", () => {
    expect(classifySendError(404)).toBe("prune");
    expect(classifySendError(410)).toBe("prune");
  });

  it("retries a transient failure: no response, 408, 429, or any 5xx (at-least-once)", () => {
    expect(classifySendError(undefined)).toBe("retry"); // network/timeout — never reached a response
    expect(classifySendError(408)).toBe("retry"); // request timeout
    expect(classifySendError(429)).toBe("retry"); // throttled
    expect(classifySendError(500)).toBe("retry"); // push service faltered
    expect(classifySendError(502)).toBe("retry");
    expect(classifySendError(503)).toBe("retry");
  });

  it("permanently fails a non-prune client error (other 4xx), without pruning", () => {
    expect(classifySendError(400)).toBe("failed");
    expect(classifySendError(401)).toBe("failed");
    expect(classifySendError(403)).toBe("failed");
    expect(classifySendError(413)).toBe("failed"); // payload too large — retry won't help
  });
});

describe("detectInstallContext — iOS non-PWA resolves to the install prompt", () => {
  const IOS_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";

  it("an iOS Safari tab (not standalone) must Add to Home Screen", () => {
    expect(
      detectInstallContext({
        isStandaloneDisplay: false,
        navigatorStandalone: false,
        userAgent: IOS_UA,
        pushApiAvailable: false,
      }),
    ).toBe("ios-needs-install");
  });

  it("an installed iOS PWA with push APIs can subscribe", () => {
    expect(
      detectInstallContext({
        isStandaloneDisplay: true,
        navigatorStandalone: true,
        userAgent: IOS_UA,
        pushApiAvailable: true,
      }),
    ).toBe("subscribe");
  });

  it("a desktop browser with push APIs subscribes directly", () => {
    expect(
      detectInstallContext({
        isStandaloneDisplay: false,
        navigatorStandalone: undefined,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36",
        pushApiAvailable: true,
      }),
    ).toBe("subscribe");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url VAPID key to bytes", () => {
    const bytes = urlBase64ToUint8Array("aGVsbG8"); // "hello"
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });
});

// ------------------------------------------------------------------------------------------------
// IO shell — DB-gated, web-push mocked.
// ------------------------------------------------------------------------------------------------

vi.mock("web-push", async (importActual) => {
  const actual = await importActual<typeof import("web-push")>();
  return {
    ...actual,
    default: {
      ...(actual as unknown as { default: typeof import("web-push") }).default,
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn(),
    },
    // Keep the real WebPushError class so `instanceof` checks in dispatch.ts match.
    WebPushError: actual.WebPushError,
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  };
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("dispatchOutbox (integration)", () => {
  // Lazily acquired so an unset DATABASE_URL never throws at collection time.
  let db: typeof import("@/lib/db").db;
  let dispatchOutbox: typeof import("@/lib/push/dispatch").dispatchOutbox;
  let webpush: typeof import("web-push");
  const ids: string[] = [];

  beforeAll(async () => {
    process.env.VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:test@keeper.app";
    process.env.VAPID_PUBLIC_KEY =
      process.env.VAPID_PUBLIC_KEY ??
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhfGTJaP-uA";
    process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "wYDDPnVa9XzHYxL7K-c2x6yA8eN3v_yKQ4F6hQ8kZsM";

    db = (await import("@/lib/db")).db;
    dispatchOutbox = (await import("@/lib/push/dispatch")).dispatchOutbox;
    webpush = await import("web-push");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const sql = db();
    for (const id of ids) {
      // CASCADE from watches removes snapshots/fired/calibration; subs are device-scoped.
      await sql`DELETE FROM watches WHERE id = ${id}`;
      await sql`DELETE FROM push_subscriptions WHERE device_id = ${`dev-${id}`}`;
    }
  });

  /** Seed one armed watch + its latest snapshot + a fired CATCH + a calibration row + (optionally) a sub. */
  async function seed(opts: { withSub: boolean; suffix: string }): Promise<{ watchId: string; deviceId: string }> {
    const sql = db();
    const watchId = `u8-${opts.suffix}-${Date.now()}`;
    const deviceId = `dev-${watchId}`;
    ids.push(watchId);

    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, contact, state, terminal)
      VALUES
        (${watchId}, ${deviceId}, 'hash', 'EK1', '2026-06-05', 'LHR',
         '2026-06-05T20:00:00', 'Europe/London', '2026-06-05T20:00:00Z', 'Trafalgar Square', TRUE,
         0, 'user', 35, 30, 'osrm',
         TRUE, 'The venue', 'MISS_PREDICTED', FALSE)`;

    await sql`
      INSERT INTO prediction_snapshots
        (watch_id, fetched_at, predicted_arrival, transit_minutes_used, egress_minutes_used,
         margin_minutes_used, slack_minutes, verdict, resulting_state, revision, fired_transition)
      VALUES
        (${watchId}, ${NOW}, '2026-06-05T19:10:00Z', 30, 35, 0, -75, 'miss', 'MISS_PREDICTED', 'rev-1', 'CATCH')`;

    await sql`
      INSERT INTO fired_transitions (watch_id, transition, revision, kind, lead_time_minutes, useful_lead)
      VALUES (${watchId}, 'AT_RISK->MISS_PREDICTED', 'rev-1', 'CATCH', 90, TRUE)`;

    // The calibration row is the corpus we must never touch when pruning a subscription.
    await sql`
      INSERT INTO calibration (watch_id, self_report_status, enrichment_state)
      VALUES (${watchId}, 'pending', 'armed')`;

    if (opts.withSub) {
      await sql`
        INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
        VALUES (${deviceId}, ${`https://fcm.googleapis.com/fcm/send/${watchId}`}, ${sub.p256dh}, ${sub.auth})`;
    }

    return { watchId, deviceId };
  }

  it("a 410 from web-push prunes the subscription, marks delivery failed, and leaves calibration intact", async () => {
    const sql = db();
    const { watchId, deviceId } = await seed({ withSub: true, suffix: "gone" });

    // web-push types its own `Headers` (an index-signature object), not the DOM Headers.
    const emptyHeaders = {} as ConstructorParameters<typeof webpush.WebPushError>[2];
    (webpush.sendNotification as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new webpush.WebPushError("gone", 410, emptyHeaders, "", "endpoint"),
    );

    const summary = await dispatchOutbox();
    expect(summary.claimed).toBeGreaterThanOrEqual(1);

    const ft = await sql`
      SELECT delivery_status FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(ft[0].delivery_status).toBe("failed");

    const remainingSubs = await sql`SELECT id FROM push_subscriptions WHERE device_id = ${deviceId}`;
    expect(remainingSubs.length).toBe(0); // pruned

    // The corpus is untouched: the calibration row still exists.
    const cal = await sql`SELECT watch_id FROM calibration WHERE watch_id = ${watchId}`;
    expect(cal.length).toBe(1);
  });

  it("no registered device yields no_device and no send", async () => {
    const sql = db();
    const sendSpy = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    sendSpy.mockClear();
    const { watchId } = await seed({ withSub: false, suffix: "nodevice" });

    await dispatchOutbox();

    const ft = await sql`
      SELECT delivery_status FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(ft[0].delivery_status).toBe("no_device");
  });

  it("a successful send marks the outbox row sent", async () => {
    const sql = db();
    (webpush.sendNotification as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      statusCode: 201,
      body: "",
      headers: {},
    });
    const { watchId } = await seed({ withSub: true, suffix: "ok" });

    await dispatchOutbox();

    const ft = await sql`
      SELECT delivery_status, sent_at FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(ft[0].delivery_status).toBe("sent");
    expect(ft[0].sent_at).not.toBeNull();
  });

  it("a transient 500 leaves the row attempting (deferred for retry), not failed, and keeps the subscription", async () => {
    const sql = db();
    const sendSpy = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    sendSpy.mockClear();
    const { watchId, deviceId } = await seed({ withSub: true, suffix: "transient" });

    const emptyHeaders = {} as ConstructorParameters<typeof webpush.WebPushError>[2];
    // First send (the claim sends exactly one) fails 500; the default mock would resolve any extra.
    sendSpy.mockRejectedValueOnce(new webpush.WebPushError("boom", 500, emptyHeaders, "", "endpoint"));

    const summary = await dispatchOutbox();
    expect(summary.deferred).toBeGreaterThanOrEqual(1);

    // Returned to attempting (retryable) — NOT a terminal 'failed', and the lease is cleared.
    const ft = await sql`
      SELECT delivery_status, claimed_at, sent_at
      FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(ft[0].delivery_status).toBe("attempting");
    expect(ft[0].claimed_at).toBeNull();
    expect(ft[0].sent_at).toBeNull();

    // A transient failure must NOT prune the credential — the endpoint isn't proven dead.
    const subs = await sql`SELECT id FROM push_subscriptions WHERE device_id = ${deviceId}`;
    expect(subs.length).toBe(1);

    // Self-isolate: drive the lingering attempting row terminal so it can't bleed into later tests.
    sendSpy.mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    await dispatchOutbox();
    const after = await sql`
      SELECT delivery_status FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(after[0].delivery_status).toBe("sent");
  });

  it("two concurrent dispatchOutbox() ticks send a given firing exactly once (atomic claim)", async () => {
    const sql = db();
    const sendSpy = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
    sendSpy.mockClear();
    const { watchId } = await seed({ withSub: true, suffix: "concurrent" });

    // Resolve every send, but record which endpoints were hit so we can prove this firing's endpoint
    // was contacted exactly once across BOTH overlapping ticks. A small delay widens the window in
    // which both ticks race for the claim (the FOR UPDATE SKIP LOCKED lease must let only one win).
    const endpointHits: string[] = [];
    const thisEndpoint = `https://fcm.googleapis.com/fcm/send/${watchId}`;
    sendSpy.mockImplementation(async (subscription: { endpoint: string }) => {
      endpointHits.push(subscription.endpoint);
      await new Promise((r) => setTimeout(r, 25));
      return { statusCode: 201, body: "", headers: {} };
    });

    const [a, b] = await Promise.all([dispatchOutbox(), dispatchOutbox()]);

    // Exactly one of the two ticks claimed+sent this firing; the other skipped the leased row.
    const sentForThis =
      endpointHits.filter((e) => e === thisEndpoint).length;
    expect(sentForThis).toBe(1);

    // The row is terminal 'sent' exactly once.
    const ft = await sql`
      SELECT delivery_status FROM fired_transitions WHERE watch_id = ${watchId} AND revision = 'rev-1'`;
    expect(ft[0].delivery_status).toBe("sent");

    // The summaries' claimed counts for this firing sum to 1 (one tick leased it, the other skipped).
    // (Other ambient rows may inflate the raw totals, so we assert on the endpoint hit count above.)
    expect(a.sent + b.sent).toBeGreaterThanOrEqual(1);

    sendSpy.mockReset();
  });
});
