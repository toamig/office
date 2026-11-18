import { EmptyState } from "../components/ui";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="p-6">
      <h1 className="m-0 mb-2 text-lg font-semibold">{title}</h1>
      <EmptyState>{note}</EmptyState>
    </div>
  );
}
