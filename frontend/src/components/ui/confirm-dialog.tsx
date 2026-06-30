import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/** A minimal confirm built on Radix Dialog: renders `trigger`; opening shows `title` +
 *  `description` with Cancel / Confirm. `onConfirm` fires on Confirm and the dialog closes. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg">
          <Dialog.Title className="text-sm font-semibold text-foreground">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            {description}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="rounded border border-border px-3 py-1 text-xs">
              Cancel
            </Dialog.Close>
            <Dialog.Close
              onClick={onConfirm}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              {confirmLabel}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
