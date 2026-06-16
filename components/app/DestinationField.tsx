"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { airportLabel, POPULAR, type Airport } from "@/lib/places/types";
import s from "@/app/onboarding/onboarding.module.css";

/**
 * Destination autocomplete backed by the server airport dataset (/api/places). Self-contained: owns its
 * query text, debounced fetch, keyboard navigation and the popular-chip quick picks; it reports the chosen
 * airport up via `onChoose` (and `onChoose(null)` the moment the user edits the text again, so a stale
 * selection can't survive an edit). Shared by the onboarding stepper and the editable trip summary.
 */
export function DestinationField({
  initialLabel = "",
  inputId = "dest",
  onChoose,
}: {
  initialLabel?: string;
  inputId?: string;
  onChoose: (a: Airport | null) => void;
}): React.ReactElement {
  const [query, setQuery] = useState(initialLabel);
  const [results, setResults] = useState<Airport[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [chosen, setChosen] = useState(Boolean(initialLabel));
  const reqId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchResults = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setCursor(-1);
      return;
    }
    const id = ++reqId.current;
    fetch(`/api/places?q=${encodeURIComponent(trimmed)}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((data: { results?: Airport[] }) => {
        // Ignore out-of-order responses — only the latest keystroke's results win.
        if (id !== reqId.current) return;
        setResults(Array.isArray(data.results) ? data.results : []);
        setCursor(-1);
      })
      .catch(() => {
        if (id === reqId.current) setResults([]);
      });
  }, []);

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const onInput = (value: string) => {
    setQuery(value);
    setChosen(false);
    onChoose(null); // editing invalidates any prior pick until they choose again
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchResults(value), 160);
  };

  const choose = (a: Airport) => {
    setQuery(airportLabel(a));
    setResults([]);
    setCursor(-1);
    setChosen(true);
    onChoose(a);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (cursor >= 0) choose(results[cursor]!); }
    else if (e.key === "Escape") { setResults([]); setCursor(-1); }
  };

  const showPopular = !chosen && query.trim().length === 0;

  return (
    <div className={s.searchBlock} style={{ padding: 0 }}>
      <div className={s.searchField}>
        <span className={s.mag}><MagIcon /></span>
        <input
          id={inputId}
          className={s.searchInput}
          type="text"
          autoComplete="off"
          placeholder="Search a city or airport…"
          value={query}
          aria-label="Destination"
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKey}
        />
      </div>

      <div className={`${s.suggest} ${results.length > 0 ? s.show : ""}`}>
        {results.map((a, i) => (
          <div
            key={a.code}
            className={`${s.sg} ${cursor === i ? s.cur : ""}`}
            onMouseDown={(e) => { e.preventDefault(); choose(a); }}
          >
            <span className={s.pin}><PinIcon /></span>
            <div>
              <div className={s.city}>{a.city}</div>
              <div className={s.country}>{a.name} · {a.country}</div>
            </div>
            <span className={s.code}>{a.code}</span>
          </div>
        ))}
      </div>

      {showPopular ? (
        <div className={s.popRow}>
          <span className={s.pl}>Popular right now</span>
          {POPULAR.map((a) => (
            <button key={a.code} type="button" className={s.chip} onClick={() => choose(a)}>{a.city}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MagIcon = (): React.ReactElement => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="m12.5 12.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PinIcon = (): React.ReactElement => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 14s5-4.2 5-8A5 5 0 0 0 3 6c0 3.8 5 8 5 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
