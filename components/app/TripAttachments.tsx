"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ATTACHMENT_KINDS, kindLabel, type TripAttachment } from "@/lib/trips/attachments";
import { uploadAttachment, deleteAttachment, getDownloadUrl } from "@/lib/trips/actions";
import s from "./tripAttachments.module.css";

const fmtSize = (n: number | null): string => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function TripAttachments({ attachments }: { attachments: TripAttachment[] }): React.ReactElement {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<string>("flight");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    if (!(data.get("file") instanceof File) || (data.get("file") as File).size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    setBusy(true);
    try {
      const res = await uploadAttachment(data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      form.reset();
      setFileName("");
      setKind("flight");
      router.refresh();
    } catch {
      setError("Upload failed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(filePath: string): Promise<void> {
    const url = await getDownloadUrl(filePath);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Couldn’t open that file — please try again.");
  }

  async function onDelete(id: string): Promise<void> {
    setError(null);
    setPendingId(id);
    try {
      const res = await deleteAttachment(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className={s.wrap}>
      <div className={s.head}>
        <h2>Attachments</h2>
        <p>Booking confirmations, tickets, and documents — pick a type for each.</p>
      </div>

      <form ref={formRef} className={s.uploader} onSubmit={onSubmit}>
        <label className={s.fileBtn}>
          <input
            type="file"
            name="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.txt"
            className={s.fileInput}
            onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? "")}
            disabled={busy}
          />
          <span>{fileName || "Choose a file…"}</span>
        </label>

        <select
          name="kind"
          className={s.kindSelect}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={busy}
          aria-label="Attachment type"
        >
          {ATTACHMENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>

        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      {error ? <p className={s.error} role="alert">{error}</p> : null}

      {attachments.length === 0 ? (
        <p className={s.empty}>No attachments yet. Add your first booking confirmation above.</p>
      ) : (
        <ul className={s.list}>
          {attachments.map((a) => (
            <li key={a.id} className={s.item}>
              <span className={`${s.chip} ${s[`chip_${a.kind}`] ?? ""}`}>{kindLabel(a.kind)}</span>
              <button type="button" className={s.name} onClick={() => onDownload(a.filePath)} title="Download">
                {a.fileName}
              </button>
              <span className={s.meta}>{[fmtSize(a.sizeBytes), fmtDate(a.createdAt)].filter(Boolean).join(" · ")}</span>
              <button
                type="button"
                className={s.del}
                onClick={() => onDelete(a.id)}
                disabled={pendingId === a.id}
                aria-label={`Remove ${a.fileName}`}
              >
                {pendingId === a.id ? "…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
