import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ComponentChildren;
  class?: string;
}

/**
 * Light-dismiss fallback for browsers without `closedby` (Safari). Esc and the
 * focus trap are native; this only adds the outside-tap path. Test the pointer
 * position, not `event.target`, because the dialog itself is the target for
 * its padding and the gaps between children.
 */
function attachLightDismiss(dialog: HTMLDialogElement): () => void {
  if ("closedBy" in HTMLDialogElement.prototype) return () => undefined;

  let pressedOutside = false;
  const outside = (event: PointerEvent) => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };

  const onPointerDown = (event: PointerEvent) => {
    pressedOutside = outside(event);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (pressedOutside && outside(event)) dialog.close();
    pressedOutside = false;
  };

  dialog.addEventListener("pointerdown", onPointerDown);
  dialog.addEventListener("pointerup", onPointerUp);
  return () => {
    dialog.removeEventListener("pointerdown", onPointerDown);
    dialog.removeEventListener("pointerup", onPointerUp);
  };
}

export function BottomSheet({
  open,
  onClose,
  labelledBy,
  children,
  class: className,
}: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closingProgrammatically = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingProgrammatically.current = true;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // `closedby="any"` is newer than the JSX typings, and older clients ignore
    // an unknown attribute; attachLightDismiss covers the ones that do.
    dialog.setAttribute("closedby", "any");
    const detachLightDismiss = attachLightDismiss(dialog);

    const handleClose = () => {
      if (closingProgrammatically.current) {
        closingProgrammatically.current = false;
        return;
      }
      onCloseRef.current();
    };

    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
      detachLightDismiss();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class={`sheet ${className ?? ""}`}
      aria-labelledby={labelledBy}
    >
      <div class="sheet-panel max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-sheet bg-surface px-4 pt-3 pb-[calc(1rem+var(--safe-bottom))] sm:rounded-sheet">
        {children}
      </div>
    </dialog>
  );
}
