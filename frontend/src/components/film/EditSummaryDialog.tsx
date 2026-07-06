import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

const MAX_LENGTH = 500;

/** A small Radix-dialog-based editor for an event summary: seeds a textarea from
 *  `initialValue`, enforces `maxLength` client-side (mirrors the backend's 500-char cap
 *  to avoid a round-trip), and keeps the dialog open with a toast on save failure. */
export function EditSummaryDialog({
  trigger,
  initialValue,
  maxLength = MAX_LENGTH,
  onSave,
}: {
  trigger: ReactNode;
  initialValue: string;
  maxLength?: number;
  onSave: (summary: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const trimmedLength = value.trim().length;
  const overLimit = trimmedLength > maxLength;
  const saveDisabled = saving || trimmedLength === 0 || overLimit;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(value);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(initialValue);
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg">
          <Dialog.Title className="text-sm font-semibold text-foreground">
            Edit summary
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Edit the summary text for this event.
          </Dialog.Description>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <div
            className={cn(
              "mt-1 text-right text-xs text-muted-foreground",
              overLimit && "text-red-500",
            )}
          >
            {trimmedLength}/{maxLength}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Dialog.Close className="rounded border border-border px-3 py-1 text-xs">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              disabled={saveDisabled}
              onClick={handleSave}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
