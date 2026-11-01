import { screen } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

type AmadeusWindowPrefs = Partial<Electron.Rectangle> & {
  alwaysOnTop?: boolean;
};
export class AmadeusWindowPreferences {
  private file: string;
  constructor(private dataDir: string) {
    this.file = path.join(dataDir, "amadeus-window.json");
  }
  read(): AmadeusWindowPrefs {
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8"));
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }
  write(patch: AmadeusWindowPrefs): void {
    try {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      const temporary = this.file + ".tmp";
      writeFileSync(temporary, JSON.stringify({ ...this.read(), ...patch }), {
        mode: 0o600,
      });
      renameSync(temporary, this.file);
    } catch {
      /* Optional window preferences. */
    }
  }
  bounds(): Electron.Rectangle | undefined {
    const value = this.read();
    if (
      ![value.x, value.y, value.width, value.height].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      ) ||
      (value.width ?? 0) < 400 ||
      (value.height ?? 0) < 500
    )
      return;
    const bounds = {
      x: value.x!,
      y: value.y!,
      width: value.width!,
      height: value.height!,
    };
    return screen
      .getAllDisplays()
      .some(
        ({ workArea }) =>
          bounds.x < workArea.x + workArea.width - 80 &&
          bounds.x + bounds.width > workArea.x + 80 &&
          bounds.y < workArea.y + workArea.height - 80 &&
          bounds.y + bounds.height > workArea.y + 80,
      )
      ? bounds
      : undefined;
  }
}
