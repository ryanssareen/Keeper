// Client-safe attachment constants, types, and pure helpers. NO server imports here — this module is
// pulled into the browser bundle by the upload UI, so the Supabase server client (next/headers) lives
// in `lib/trips/queries.ts` instead.

export const BUCKET = "trip-docs";

/** The fixed set of booking-document classifications a user picks from on upload. */
export const ATTACHMENT_KINDS = [
  { value: "flight", label: "Flight" },
  { value: "hotel", label: "Hotel" },
  { value: "car", label: "Car rental" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]["value"];

export const isAttachmentKind = (v: unknown): v is AttachmentKind =>
  typeof v === "string" && ATTACHMENT_KINDS.some((k) => k.value === v);

export const kindLabel = (value: string): string =>
  ATTACHMENT_KINDS.find((k) => k.value === value)?.label ?? "Other";

export type TripAttachment = {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  filePath: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};
