import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
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
