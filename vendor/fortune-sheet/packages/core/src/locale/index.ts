import en from "./en";
import zh from "./zh";
// FPL modification (2026-11-16): only ship the application's Chinese and English locales.
import { Context } from "..";

const localeObj: Record<string, typeof zh> = {
  // @ts-ignore
  en,
  zh,
};

function locale(ctx: Context) {
  const langsToTry = [ctx.lang || "", ctx.lang?.split("-")[0] || ""];
  for (let i = 0; i < langsToTry.length; i += 1) {
    if (langsToTry[i] in localeObj) {
      return localeObj[langsToTry[i]];
    }
  }
  return localeObj.en;
}

export { locale };
