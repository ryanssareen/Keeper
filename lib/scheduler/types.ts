/** Minimal projection of a due watch — just enough to fetch its flight and reconcile it (U7). */
export interface DueWatch {
  id: string;
  flightNumber: string;
  flightDate: string; // YYYY-MM-DD
}
