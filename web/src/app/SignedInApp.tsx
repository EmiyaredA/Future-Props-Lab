import { RuntimeAccessProvider } from "@features/accounts";
import { AutomationChanges } from "./AutomationChanges";
import App from "./App";
import { useStudioSession } from "./StudioSession";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";

export default function SignedInApp() {
  const session = useStudioSession();
  return (
    <RuntimeAccessProvider>
      <AmadeusPageProvider key={session.me.user.id} session={session}>
        <App />
        <AutomationChanges userId={session.me.user.id} />
      </AmadeusPageProvider>
    </RuntimeAccessProvider>
  );
}
