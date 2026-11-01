/** Request the page-owned assistant without coupling features to the application shell. */
export function openAmadeus(): Promise<void> {
  window.dispatchEvent(new Event("future-props:open-amadeus"));
  return Promise.resolve();
}

export function subscribeAmadeusMutation(callback: (value: unknown) => void) {
  const handler = (event: Event) =>
    callback((event as CustomEvent<unknown>).detail);
  window.addEventListener("future-props:amadeus-mutation", handler);
  return () =>
    window.removeEventListener("future-props:amadeus-mutation", handler);
}
