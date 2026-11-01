import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    });
  }
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.dataset.theme = "light";
});

afterEach(() => cleanup());

// Component tests model the authenticated application shell. Explicit providers
// inside a test still override this account and its fixed permissions.
vi.mock("@testing-library/react", async (original) => {
  const actual = await original<typeof import("@testing-library/react")>();
  const React = await import("react");
  const { AccountAccessProvider } =
    await import("@platform/auth/AccountAccess");
  const permissions = [
    "content.read",
    "content.write",
    "models.use",
    "configuration.manage",
    "logs.read",
    "audit.read",
    "docs.developer",
    "diagnostics.model",
    "diagnostics.realtime",
    "tools.sensitive",
    "projects.certify",
  ];
  return {
    ...actual,
    render: (
      ui: React.ReactNode,
      options?: Parameters<typeof actual.render>[1],
    ) => {
      if (
        React.isValidElement<{ children?: React.ReactNode }>(ui) &&
        ui.type === React.StrictMode
      ) {
        return actual.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(AccountAccessProvider, {
              userId: "test-user",
              permissions,
              children: ui.props.children,
            }),
          ),
          options,
        );
      }
      const Wrapper = options?.wrapper;
      return actual.render(ui, {
        ...options,
        wrapper: ({ children }: { children: React.ReactNode }) =>
          React.createElement(AccountAccessProvider, {
            userId: "test-user",
            permissions,
            children: Wrapper
              ? React.createElement(Wrapper, null, children)
              : children,
          }),
      });
    },
  };
});
