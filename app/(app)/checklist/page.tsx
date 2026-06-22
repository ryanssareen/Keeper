import type { Metadata } from "next";
import { loadChecklist } from "@/lib/checklist/queries";
import { seedChecklist } from "@/lib/checklist/actions";
import { ChecklistView } from "@/components/app/ChecklistView";

export const metadata: Metadata = { title: "Keeper — Checklist" };

export default async function ChecklistPage(): Promise<React.ReactElement> {
  let items = await loadChecklist();

  // Seed the default list the very first time the page loads empty.
  if (items.length === 0) {
    await seedChecklist();
    items = await loadChecklist();
  }

  return <ChecklistView initialItems={items} />;
}
