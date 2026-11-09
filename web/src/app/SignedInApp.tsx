import { RuntimeAccessProvider } from "@features/accounts";
import { AutomationChanges } from "./AutomationChanges";
import WebsiteRoutes from "./routing/WebsiteRoutes";
import { useStudioSession } from "./StudioSession";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { useWebsiteNavigation } from "./routing/useWebsiteNavigation";

export default function SignedInApp() {
  const session = useStudioSession();
  const navigation = useWebsiteNavigation();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider
        key={session.me.user.id}
        session={session}
        workspaceOnly={navigation.route.page === "amadeus"}
      >
        <WebsiteRoutes navigation={navigation} />
        <AutomationChanges userId={session.me.user.id} />
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
