import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ApplicationNavigation } from "@app/routing/ApplicationNavigation";
import { NavigationProtection } from "@shared/ui/NavigationProtection";

afterEach(() => history.replaceState({}, "", "/home"));

test.each([
  ["/apps", true],
  ["/apps/", true],
  ["/home", true],
  ["/cloud-control", true],
  ["/apps/visual-workshop", false],
  ["/apps/video-editor", false],
  ["/docs.html", false],
] as const)("portal exact path interception for %s is %s", (target, local) => {
  history.replaceState({}, "", "/home");
  render(
    <NavigationProtection>
      <ApplicationNavigation
        scope="portal"
        exactPaths={["/", "/home", "/apps", "/cloud-control"]}
      >
        <a href={target}>目标</a>
      </ApplicationNavigation>
    </NavigationProtection>,
  );
  let intercepted = false;
  const browserDefault = (event: MouseEvent) => {
    intercepted = event.defaultPrevented;
    event.preventDefault(); // jsdom cannot perform the browser's document load.
  };
  window.addEventListener("click", browserDefault);
  try {
    fireEvent.click(screen.getByRole("link"));
    expect(intercepted).toBe(local);
    expect(location.pathname).toBe(local ? target : "/home");
  } finally {
    window.removeEventListener("click", browserDefault);
  }
});
