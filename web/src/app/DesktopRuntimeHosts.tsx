import { DesktopAgentHost } from "./DesktopAgentHost";
import { AmadeusSourceHost } from "@features/amadeus/SourceHost";

export default function DesktopRuntimeHosts() {
  return (
    <>
      <DesktopAgentHost />
      <AmadeusSourceHost />
    </>
  );
}
