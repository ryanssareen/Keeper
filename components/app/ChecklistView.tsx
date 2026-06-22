"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  toggleChecklistItem,
  addChecklistItem,
  deleteChecklistItem,
} from "@/lib/checklist/actions";
import { checklistProgress, MAX_LABEL, type ChecklistItem } from "@/lib/checklist/checklist";
import s from "./checklist.module.css";

export function ChecklistView({ initialItems }: { initialItems: ChecklistItem[] }): React.ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic state: override map for done-state, set of removed ids
  const [doneOverride, setDoneOverride] = useState<Map<string, boolean>>(new Map());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [addLabel, setAddLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = initialItems
    .filter((it) => !removedIds.has(it.id))
    .map((it) => ({
      ...it,
      done: doneOverride.has(it.id) ? (doneOverride.get(it.id) as boolean) : it.done,
    }));

  const progress = checklistProgress(items);

  function handleToggle(id: string, next: boolean) {
    setDoneOverride((m) => new Map(m).set(id, next));
    startTransition(() => {
      void toggleChecklistItem(id, next).then(() => router.refresh());
    });
  }

  function handleRemove(id: string) {
    setRemovedIds((s) => new Set(s).add(id));
    startTransition(() => {
      void deleteChecklistItem(id).then(() => router.refresh());
    });
  }

  async function handleAdd() {
    const label = addLabel.trim();
    if (!label) return;
    setAdding(true);
    setAddLabel("");
    const result = await addChecklistItem(label);
    setAdding(false);
    if (result.ok) router.refresh();
    else setAddLabel(label); // restore on failure
  }

  return (
    <div className={s.wrap}>
      {/* Progress header */}
      <div className={`card card-pad ${s.progressCard}`}>
        <div className={s.progressRow}>
          <span className={s.progressLabel}>{progress.pct}% done</span>
          <span className={s.progressCount}>{progress.done} / {progress.total}</span>
        </div>
        <div className={s.pbarTrack}>
          <div className={s.pbarFill} style={{ width: `${progress.pct}%` }} />
        </div>
      </div>

      {/* Items */}
      <div className={`card ${s.listCard}`}>
        {items.length === 0 ? (
          <div className={s.empty}>
            <p>Your checklist is empty. Add your first item below.</p>
          </div>
        ) : (
          <ul className={s.list}>
            {items.map((item) => (
              <li key={item.id} className={`${s.item} ${item.done ? s.done : ""}`}>
                <button
                  className={`${s.ckbox} ${item.done ? s.ckboxDone : ""}`}
                  aria-label={item.done ? "Mark undone" : "Mark done"}
                  onClick={() => handleToggle(item.id, !item.done)}
                >
                  {item.done ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
                <span className={s.itemLabel}>{item.label}</span>
                <button
                  className={s.removeBtn}
                  aria-label="Remove item"
                  onClick={() => handleRemove(item.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add row */}
        <div className={s.addRow}>
          <input
            ref={inputRef}
            className={`field ${s.addInput}`}
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value.slice(0, MAX_LABEL))}
            placeholder="Add an item…"
            disabled={adding}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
          />
          <button
            className={`btn btn-primary btn-sm ${s.addBtn}`}
            onClick={() => void handleAdd()}
            disabled={adding || !addLabel.trim()}
          >
            {adding ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
