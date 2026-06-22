import type { Metadata } from "next";
import { loadChecklistSeeded } from "@/lib/checklist/queries";
import { ChecklistView } from "@/components/app/ChecklistView";

export const metadata: Metadata = { title: "Keeper — Checklist" };

export default async function ChecklistPage(): Promise<React.ReactElement> {
  // Seeds the default list on first (empty) load via a render-safe query — calling the seedChecklist
  // server action here would 500, since it runs revalidatePath, which Next forbids during render.
  const items = await loadChecklistSeeded();
  return <ChecklistView initialItems={items} />;
}
