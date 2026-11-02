export function guardedNavigation(
  proceed: () => void,
  documentNavigation = false,
) {
  const event = Object.assign(
    new CustomEvent("future-props:before-navigation", {
      cancelable: true,
      detail: proceed,
    }),
    { documentNavigation },
  );
  if (window.dispatchEvent(event)) proceed();
}
