import { lazy, Suspense } from "react";
import App from "./App";

const DesktopRuntimeHosts = lazy(() => import("./DesktopRuntimeHosts"));

export default function SignedInApp() {
  return (
    <>
      <App />
      {window.futurePropsDesktop && (
        <Suspense fallback={null}>
          <DesktopRuntimeHosts />
        </Suspense>
      )}
    </>
  );
}
