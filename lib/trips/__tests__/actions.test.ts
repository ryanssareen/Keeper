import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase server client (auth + table + storage) and the signed-URL query so the upload/
// delete/download actions are testable without a DB or bucket. Mirrors lib/onboarding's action test.
const getUser = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const insert = vi.fn();
const maybeSingle = vi.fn();
const deleteFinal = vi.fn();
const signedUrl = vi.fn();
const revalidatePath = vi.fn();

const storageFrom = vi.fn(() => ({ upload, remove }));

function makeQuery() {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.insert = (...a: unknown[]) => insert(...a);
  q.delete = () => q;
  q.eq = () => q;
  q.maybeSingle = (...a: unknown[]) => maybeSingle(...a);
  // Make the chain awaitable for `await from().delete().eq().eq()`.
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(deleteFinal()).then(res, rej);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from: () => makeQuery(), storage: { from: storageFrom } })),
}));
vi.mock("@/lib/trips/queries", () => ({ signedUrl: (...a: unknown[]) => signedUrl(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { uploadAttachment, deleteAttachment, getDownloadUrl } from "@/lib/trips/actions";

const fileForm = (file: File, kind = "flight"): FormData => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  return fd;
};
const pdf = () => new File(["ticket-bytes"], "ticket.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  insert.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: null, error: null });
  deleteFinal.mockReturnValue({ error: null });
  signedUrl.mockResolvedValue("https://signed.example/x");
});

describe("uploadAttachment", () => {
  it("rejects an unauthenticated caller without touching storage", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await uploadAttachment(fileForm(pdf()));
    expect(res).toEqual({ ok: false, error: expect.stringContaining("signed in") });
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an empty/missing file, an oversized file, and a disallowed extension", async () => {
    expect(await uploadAttachment(new FormData())).toMatchObject({ ok: false });

    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    expect((await uploadAttachment(fileForm(big))).ok).toBe(false);

    const exe = new File(["x"], "malware.exe", { type: "application/octet-stream" });
    expect((await uploadAttachment(fileForm(exe))).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns failure and does not insert a row when the storage upload fails", async () => {
    upload.mockResolvedValue({ error: { message: "storage down" } });
    const res = await uploadAttachment(fileForm(pdf()));
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rolls back the uploaded object when the row insert fails", async () => {
    insert.mockResolvedValue({ error: { message: "permission denied" } });
    const res = await uploadAttachment(fileForm(pdf()));
    expect(res.ok).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1); // orphaned object removed
  });

  it("uploads, inserts the row with the chosen kind, and revalidates on success", async () => {
    const res = await uploadAttachment(fileForm(pdf(), "hotel"));
    expect(res).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", kind: "hotel", file_name: "ticket.pdf" }));
    expect(revalidatePath).toHaveBeenCalledWith("/trips");
  });

  it("coerces an unknown kind to 'other'", async () => {
    await uploadAttachment(fileForm(pdf(), "spaceship"));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "other" }));
  });
});

describe("deleteAttachment", () => {
  it("reports not-found when the row doesn't belong to the caller", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await deleteAttachment("a1")).toEqual({ ok: false, error: expect.stringContaining("no longer exists") });
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the storage object BEFORE the row, leaving the row intact if storage fails", async () => {
    maybeSingle.mockResolvedValue({ data: { file_path: "user-1/x.pdf" }, error: null });
    remove.mockResolvedValue({ error: { message: "storage down" } });
    const res = await deleteAttachment("a1");
    expect(res.ok).toBe(false);
    expect(remove).toHaveBeenCalledWith(["user-1/x.pdf"]);
    expect(deleteFinal).not.toHaveBeenCalled(); // row delete never ran
  });

  it("removes object then row and revalidates on success", async () => {
    maybeSingle.mockResolvedValue({ data: { file_path: "user-1/x.pdf" }, error: null });
    const res = await deleteAttachment("a1");
    expect(res).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(["user-1/x.pdf"]);
    expect(revalidatePath).toHaveBeenCalledWith("/trips");
  });
});

describe("getDownloadUrl — ownership-gated signing", () => {
  it("returns null for an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getDownloadUrl("user-1/x.pdf")).toBeNull();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it("returns null (won't sign) when the path isn't owned by the caller", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getDownloadUrl("someone-else/x.pdf")).toBeNull();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it("signs the URL only after confirming ownership", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "a1" }, error: null });
    expect(await getDownloadUrl("user-1/x.pdf")).toBe("https://signed.example/x");
    expect(signedUrl).toHaveBeenCalledWith("user-1/x.pdf", 120);
  });
});
