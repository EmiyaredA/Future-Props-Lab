/** Recovery never retries API writes and uses the same navigation guard as desktop updates. */
export function recoverPage(home = false) {
  const proceed = () => {
    if (home) window.location.assign("/apps");
    else window.location.reload();
  };
  const event = new CustomEvent("future-props:before-workspace-switch", {
    cancelable: true,
    detail: proceed,
  });
  if (window.dispatchEvent(event)) proceed();
}
