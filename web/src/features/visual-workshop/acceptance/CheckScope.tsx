import { AudioLines, Film, Image, UserRound } from "lucide-react";
import type { Criterion } from "./api";
const icons = [Image, UserRound, Film, AudioLines];
export function CheckScope({ criteria }: { criteria: Criterion[] }) {
  return (
    <div className="acceptance-scope-items">
      {criteria.map((item, index) => {
        const Icon = icons[index] ?? Image;
        return (
          <span key={item.id}>
            <Icon size={22} aria-hidden="true" />
            {item.title}
          </span>
        );
      })}
    </div>
  );
}
