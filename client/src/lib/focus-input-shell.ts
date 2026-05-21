export function focusInputShell(event: React.PointerEvent<HTMLElement>) {
  const target = event.target as HTMLElement;

  if (
    target.closest(
      "button,a,input,textarea,select,label,[role='button'],[contenteditable='true'],[data-no-shell-focus='true']",
    )
  ) {
    return;
  }

  const control = event.currentTarget.querySelector(
    "textarea,input:not([type='hidden'])",
  ) as HTMLTextAreaElement | HTMLInputElement | null;

  if (!control || control.disabled || control.readOnly) return;

  event.preventDefault();
  control.focus();

  const valueLength = control.value.length;
  try {
    control.setSelectionRange(valueLength, valueLength);
  } catch {
    // ignore for input types that do not support selection
  }
}