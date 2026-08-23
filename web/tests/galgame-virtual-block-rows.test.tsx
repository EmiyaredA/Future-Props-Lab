import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { useVirtualBlockRows } from "@features/galgame-workshop/editor/useVirtualBlockRows";

function VirtualHarness({ selectedIndex = -1 }: { selectedIndex?: number }) {
  const virtual = useVirtualBlockRows({ count: 1000, selectedIndex });
  return (
    <div
      ref={virtual.containerRef}
      onScroll={virtual.onScroll}
      style={{ height: 900, overflow: "auto" }}
    >
      <div style={{ height: virtual.totalHeight }}>
        {virtual.indexes.map((index) => (
          <article key={index} data-testid="row" data-virtual-index={index}>
            Block {index}
          </article>
        ))}
      </div>
    </div>
  );
}

test("keeps a 1000-block editor below 100 mounted rows", () => {
  render(<VirtualHarness />);
  expect(screen.getAllByTestId("row").length).toBeLessThan(100);
  expect(screen.getByText("Block 0")).toBeInTheDocument();
});
