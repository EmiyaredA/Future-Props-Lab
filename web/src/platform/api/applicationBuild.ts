const service = String(import.meta.env.VITE_FPL_SERVICE || "");
const build = String(import.meta.env.VITE_FPL_WEB_BUILD || "");

export function addApplicationBuild(request: Request): Request {
  if (service && build) {
    request.headers.set("X-Application-Id", service);
    request.headers.set("X-Application-Build", build);
  }
  return request;
}

export function observeApplicationBuild(response: Response) {
  if (
    service &&
    response.headers.get("X-Application-Id") === service &&
    response.headers.get("X-Application-Build") &&
    response.headers.get("X-Application-Build") !== build
  ) {
    window.dispatchEvent(
      new CustomEvent("future-props:application-update", { detail: service }),
    );
  }
}
