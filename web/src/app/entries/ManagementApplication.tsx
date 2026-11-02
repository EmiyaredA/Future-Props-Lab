import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStudioSession } from "@app/StudioSession";
import {
  ManagementConsole,
  type ManagementPage,
} from "@features/accounts/ManagementConsole";
import { RuntimeAccessContext } from "@features/accounts/useRuntimeAccess";
import { accountQueryKeys } from "@features/accounts/queryKeys";
import { api, unwrap } from "@platform/api/client";

const pages = [
  "accounts",
  "invites",
  "settings",
  "services",
  "quotas",
  "audit",
  "application",
  "access",
] as const;
function parse(): ManagementPage {
  const name = location.pathname.split("/")[2];
  return `management-${pages.find((page) => page === name) ?? "accounts"}`;
}
export function ManagementApplication() {
  const session = useStudioSession();
  const [page, setPage] = useState(parse);
  const currentPage = useRef(page);
  currentPage.current = page;
  const runtime = useQuery({
    queryKey: accountQueryKeys.managementRuntime,
    queryFn: async () => unwrap(await api.GET("/v1/management/runtime")),
  });
  useEffect(() => {
    const pop = () => {
      const next = parse();
      const destination = location.pathname;
      const event = new CustomEvent("future-props:before-navigation", {
        cancelable: true,
        detail: () => {
          history.pushState({}, "", destination);
          setPage(next);
        },
      });
      window.dispatchEvent(event);
      if (event.defaultPrevented)
        history.pushState(
          {},
          "",
          "/management/" + currentPage.current.replace("management-", ""),
        );
      else setPage(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return (
    <RuntimeAccessContext value={runtime.data?.local_browser === true}>
      <ManagementConsole
        page={page}
        session={session}
        navigate={(next) => {
          history.pushState(
            {},
            "",
            "/management/" + next.replace("management-", ""),
          );
          setPage(next);
        }}
        onBack={() => window.location.assign("/management/application")}
      />
    </RuntimeAccessContext>
  );
}
