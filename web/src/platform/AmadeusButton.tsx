import { Sparkles } from "lucide-react";
import { openAmadeus } from "./assistant";
import { useAccountPermission } from "./auth/AccountAccess";

export function AmadeusButton({
  className,
  source,
}: {
  className?: string;
  source?: Parameters<typeof openAmadeus>[0];
}) {
  const canRead = useAccountPermission("content.read");
  if (!canRead) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label="打开 Amadeus"
      onClick={() => void openAmadeus(source)}
    >
      <Sparkles size={16} aria-hidden /> Amadeus
    </button>
  );
}
