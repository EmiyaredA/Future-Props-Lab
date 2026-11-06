export function toolCode(text: string, name: string) {
  const command =
    /(?:^|[._])(?:exec|exec_command|run_command|bash|shell|terminal)$/i.test(
      name,
    );
  if (!command)
    return {
      text,
      language: text.trim().startsWith("{") ? "json" : undefined,
      label: "调用参数",
    };
  try {
    const data = JSON.parse(text);
    const value = data.cmd ?? data.command;
    if (typeof value === "string")
      return { text: value, language: "bash", label: "Shell" };
  } catch {
    /* Native exec may contain a raw script instead of JSON. */
  }
  const script = /\b(?:const |let |await |tools\.|Promise\.)/.test(text);
  return {
    text,
    language: script ? "javascript" : "bash",
    label: script ? "JavaScript" : "Shell",
  };
}
