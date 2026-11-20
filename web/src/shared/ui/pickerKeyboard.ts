/** Close only the native picker when an enclosing Radix dialog handles Escape. */
export function keepPickerEscapeLocal(event: KeyboardEvent) {
  const child =
    event.target instanceof Element &&
    event.target.closest("dialog.searchable-picker[open]");
  if (!child) return false;
  event.preventDefault();
  if (!event.isComposing)
    child.dispatchEvent(new Event("cancel", { cancelable: true }));
  return true;
}
