import { describe, it, expect, vi, beforeEach } from "vitest";
import { assembleItinerary } from "@/lib/itinerary/assemble";
import type { CandidatePlan } from "@/lib/itinerary/generate";

// --- Supabase mock for the action guards (getUser returns null = unauthenticated) ---
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

import { generateItinerary, deleteItineraryItem, setItemStatus } from "@/lib/itinerary/actions";

const plan: CandidatePlan = {
  days: [
    {
      date: "2026-06-09",
      places: [
        { name: "Belém Tower", localName: "Torre de Belém", kind: "sight" },
        { name: "Lunch", localName: "Time Out Market", kind: "food" },
        { name: "Ghost", localName: "Nonexistent Place", kind: "other" },
      ],
    },
  ],
};

describe("assembleItinerary — resolve → envelope → feasibility (pure, injected geocoder)", () => {
  it("schedules resolved items and counts drops", async () => {
    const geocode = vi.fn(async (localName: string) =>
      localName === "Nonexistent Place"
        ? null
        : { lat: localName === "Torre de Belém" ? 38.6916 : 38.71, lng: -9.2 },
    );
    const r = await assembleItinerary(
      plan,
      { city: "Lisbon", startDate: "2026-06-09", endDate: "2026-06-09" },
      { geocode, rateMs: 0 },
    );
    expect(r.items).toHaveLength(2); // two resolve; the ghost drops
    expect(r.dropped).toBe(1);
    expect(r.items[0]!.startTs).toBeTruthy(); // envelope assigned a time
    expect(Array.isArray(r.advisories)).toBe(true);
  });
});

describe("itinerary actions — auth + validation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("generateItinerary requires a signed-in user", async () => {
    expect(await generateItinerary()).toEqual({ ok: false, error: "You need to be signed in." });
  });

  it("deleteItineraryItem requires a signed-in user", async () => {
    expect(await deleteItineraryItem("id")).toMatchObject({ ok: false });
  });

  it("setItemStatus rejects an unknown status before touching the DB", async () => {
    expect(await setItemStatus("id", "teleported")).toEqual({ ok: false, error: "Unknown status." });
  });
});
