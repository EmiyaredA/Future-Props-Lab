/** Request the page-owned assistant without coupling features to the application shell. */
export function openAmadeus(source?: {
  application: string;
  projectId?: string;
  title?: string;
}): Promise<void> {
  if (source) {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: { ...source, path: location.pathname },
      }),
    );
  }
  window.dispatchEvent(new Event("future-props:open-amadeus"));
  return Promise.resolve();
}

export type AmadeusMutation = {
  resource: string;
  projectId?: string;
  elementId?: string;
};

type ProjectRefresh = "updated" | "dirty";

export function refreshAmadeusProject(target: AmadeusMutation) {
  let result: Promise<ProjectRefresh> | undefined;
  window.dispatchEvent(
    new CustomEvent("future-props:amadeus-project-refresh", {
      detail: {
        ...target,
        respond: (refresh: () => Promise<ProjectRefresh>) => {
          result ??= Promise.resolve().then(refresh);
        },
      },
    }),
  );
  return result;
}

export function subscribeAmadeusMutation(
  target: AmadeusMutation,
  refresh: () => Promise<ProjectRefresh>,
) {
  const eventName = "future-props:amadeus-project-refresh";
  const handler = (event: Event) => {
    const change = (
      event as CustomEvent<
        AmadeusMutation & {
          respond: (refresh: () => Promise<ProjectRefresh>) => void;
        }
      >
    ).detail;
    if (
      change.resource === target.resource &&
      change.projectId === target.projectId
    )
      change.respond(refresh);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
