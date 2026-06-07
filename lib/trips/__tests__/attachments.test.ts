import { describe, it, expect } from "vitest";
import { ATTACHMENT_KINDS, isAttachmentKind, kindLabel } from "@/lib/trips/attachments";

describe("attachment classification helpers", () => {
  it("exposes a fixed, non-empty set of kinds with stable values", () => {
    expect(ATTACHMENT_KINDS.map((k) => k.value)).toEqual(["flight", "hotel", "car", "insurance", "other"]);
  });

  it("validates a kind against the allowed set (the upload action's guard)", () => {
    expect(isAttachmentKind("hotel")).toBe(true);
    expect(isAttachmentKind("flight")).toBe(true);
    expect(isAttachmentKind("spaceship")).toBe(false);
    expect(isAttachmentKind(undefined)).toBe(false);
    expect(isAttachmentKind(42)).toBe(false);
  });

  it("maps a kind value to its display label, falling back to Other", () => {
    expect(kindLabel("car")).toBe("Car rental");
    expect(kindLabel("insurance")).toBe("Insurance");
    expect(kindLabel("nonsense")).toBe("Other");
  });
});
