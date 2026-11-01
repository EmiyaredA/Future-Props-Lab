import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { FileManagementPage } from "@features/files/FileManagementPage";
import {
  getStorageLayoutStatus,
  migrateStorageLayout,
  openLibraryFolder,
} from "@features/files/api";

vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: () => <div>素材列表</div>,
}));

vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getStorageLayoutStatus: vi.fn(),
    migrateStorageLayout: vi.fn(),
    openLibraryFolder: vi.fn(),
  };
});

const pendingStatus = {
  target_version: 2 as const,
  account_upgrade_pending: 0,
  restart_required: false,
  pending_projects: 2,
  pending_assets: 3,
  migrated_assets: 1,
  pending_bytes: 4096,
  missing_files: 0,
  conflicting_files: 0,
  complete: false,
};

function batch(overrides = {}) {
  return {
    account_upgrade_pending: 0,
    restart_required: false,
    processed_assets: 2,
    migrated_projects: 1,
    migrated_assets: 2,
    already_materialized_assets: 0,
    missing_files: 0,
    conflicts: 0,
    remaining_projects: 1,
    remaining_assets: 1,
    issues: [],
    complete: false,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FileManagementPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStorageLayoutStatus).mockResolvedValue(pendingStatus);
  vi.mocked(openLibraryFolder).mockResolvedValue({ opened: true });
});

test("shows open-library control without workspace eyebrow", async () => {
  const user = userEvent.setup();
  vi.mocked(getStorageLayoutStatus).mockResolvedValue({
    ...pendingStatus,
    pending_projects: 0,
    pending_assets: 0,
    complete: true,
  });
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "文件管理" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("工作空间")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开本地文件夹" }));
  await waitFor(() => expect(openLibraryFolder).toHaveBeenCalledTimes(1));
});

test("migrates storage in ordered batches and hides the prompt when complete", async () => {
  const user = userEvent.setup();
  vi.mocked(migrateStorageLayout)
    .mockResolvedValueOnce(batch())
    .mockResolvedValueOnce(
      batch({
        account_upgrade_pending: 0,
        restart_required: false,
        processed_assets: 1,
        migrated_projects: 1,
        migrated_assets: 1,
        remaining_projects: 0,
        remaining_assets: 0,
        complete: true,
      }),
    );
  vi.mocked(getStorageLayoutStatus)
    .mockResolvedValueOnce(pendingStatus)
    .mockResolvedValue({
      ...pendingStatus,
      pending_projects: 0,
      pending_assets: 0,
      complete: true,
    });

  renderPage();
  expect(await screen.findByText("整理项目素材目录")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "开始迁移" }));

  await waitFor(() => expect(migrateStorageLayout).toHaveBeenCalledTimes(2));
  expect(migrateStorageLayout).toHaveBeenNthCalledWith(1, 50);
  expect(await screen.findByText("项目素材目录整理完成")).toBeInTheDocument();
});

test("stops on an issue and leaves a continue action", async () => {
  const user = userEvent.setup();
  vi.mocked(migrateStorageLayout).mockResolvedValue(
    batch({
      migrated_assets: 0,
      issues: [
        {
          asset_id: "asset-1",
          code: "source_missing",
          message: "找不到旧版素材文件",
        },
      ],
    }),
  );

  renderPage();
  await user.click(await screen.findByRole("button", { name: "开始迁移" }));

  expect(await screen.findByText(/找不到旧版素材文件/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续迁移" })).toBeInTheDocument();
  expect(migrateStorageLayout).toHaveBeenCalledTimes(1);
});
