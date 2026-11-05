import { RuntimeAccessProvider } from "@features/accounts";
import { AutomationChanges } from "./AutomationChanges";
import WebsiteRoutes from "./routing/WebsiteRoutes";
import { useStudioSession } from "./StudioSession";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";

export default function SignedInApp() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <WebsiteRoutes />
        <AutomationChanges userId={session.me.user.id} />
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
