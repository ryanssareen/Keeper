import type { CandidatePlan } from "@/lib/itinerary/generate";
import { resolveCandidates, type ResolveDeps } from "@/lib/itinerary/resolve";
import { scheduleWithinEnvelope } from "@/lib/itinerary/envelope";
import { checkFeasibility, type Advisory } from "@/lib/itinerary/feasibility";
import type { MonitorableItem } from "@/lib/itinerary/itinerary";

/**
 * Pure server-side orchestration of the gate pipeline (resolve → envelope → feasibility). Kept out of
 * the "use server" actions module so it is unit-testable with an injected geocoder + a stub plan.
 */
export type AssembleCtx = {
  city: string;
  startDate: string;
  endDate: string;
  ianaZone?: string;
  arrivalInstant?: string | null;
  departureInstant?: string | null;
  assumed?: string[];
};

export async function assembleItinerary(
  plan: CandidatePlan,
  ctx: AssembleCtx,
  deps: ResolveDeps = {},
): Promise<{
  items: MonitorableItem[];
  dropped: number;
  dropResolve: number;
  dropEnvelope: number;
  advisories: Advisory[];
  assumed: string[];
}> {
  const { items: resolved, dropped: dropResolve } = await resolveCandidates(plan, ctx.city, deps);
  const zone = ctx.ianaZone ?? resolved[0]?.ianaZone ?? "UTC";
  const { scheduled, dropped: dropEnvelope, assumed } = scheduleWithinEnvelope(resolved, {
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    ianaZone: zone,
    arrivalInstant: ctx.arrivalInstant,
    departureInstant: ctx.departureInstant,
    assumed: ctx.assumed,
  });
  return {
    items: scheduled,
    dropped: dropResolve + dropEnvelope,
    dropResolve,
    dropEnvelope,
    advisories: checkFeasibility(scheduled),
    assumed,
  };
}
