import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyOfficialPage } from "@features/thought-workshop/community/LegacyOfficialPage";
import { resolveOfficialLink } from "@features/thought-workshop/community/api";
import type { components } from "@generated/api";
vi.mock("@features/thought-workshop/community/api", () => ({
  resolveOfficialLink: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
const target = (id: string) =>
  ({
    note_id: id,
    title: "当前正文",
    excerpt: "当前摘要",
    publication: { id: `pub-${id}`, title: "已发布指南", author: "管理员" },
  }) as components["schemas"]["LegacyTarget"];
function setup() {
  const open = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LegacyOfficialPage
        libraryId="technical"
        documentId="scope"
        onOpen={open}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return open;
}
describe("legacy official routes resolve ordinary publications", () => {
  it("opens a single visible publication", async () => {
    vi.mocked(resolveOfficialLink).mockResolvedValue([target("one")]);
    const open = setup();
    await waitFor(() => expect(open).toHaveBeenCalledWith("pub-one", "one"));
  });
  it("does not restore static reading when nothing is published", async () => {
    vi.mocked(resolveOfficialLink).mockResolvedValue([]);
    const open = setup();
    expect(await screen.findByText(/尚未导入并发布/)).toBeVisible();
    expect(open).not.toHaveBeenCalled();
  });
  it("asks the reader to choose among multiple visible imports", async () => {
    vi.mocked(resolveOfficialLink).mockResolvedValue([
      target("one"),
      target("two"),
    ]);
    const open = setup();
    const buttons = await screen.findAllByRole("link", {
      name: /已发布指南/,
    });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(buttons[1]);
    expect(open).toHaveBeenCalledWith("pub-two", "two");
  });
});
