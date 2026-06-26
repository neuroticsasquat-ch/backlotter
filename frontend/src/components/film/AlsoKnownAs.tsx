/** Quiet "Also known as" line listing a film's alternative titles. */
export function AlsoKnownAs({ titles }: { titles: string[] }) {
  if (titles.length === 0) return null;

  return (
    <p className="text-sm text-gray-500">
      <span className="font-medium">Also known as</span> {titles.join(", ")}
    </p>
  );
}
