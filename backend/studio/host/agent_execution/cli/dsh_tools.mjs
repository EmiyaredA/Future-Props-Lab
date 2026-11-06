// This monotonic guard applies to every tool, including tools added by later CLI versions.
export const inject = ["tools"];
export function apply(ctx) {
  const allowed = new Set(JSON.parse(process.env.FPL_CLI_ALLOWED_TOOLS || "[]"));
  ctx.tools.guard((execution) => allowed.has(execution.name) ? undefined : "FPL only permits declared task tools");
}
