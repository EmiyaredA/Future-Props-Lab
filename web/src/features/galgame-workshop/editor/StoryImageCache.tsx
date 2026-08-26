import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { fetchApiBlob } from "@platform/api/client";

type StoryImageCacheEntry = {
  fileId: string;
  refs: number;
  promise?: Promise<string>;
  url?: string;
};

const MAX_RETAINED_IMAGES = 96;

class StoryImageCache {
  private readonly entries = new Map<string, StoryImageCacheEntry>();
  private disposed = false;

  retain(fileId: string) {
    const entry = this.entry(fileId);
    entry.refs += 1;
    this.touch(entry);
    return () => {
      entry.refs = Math.max(0, entry.refs - 1);
      this.trim();
    };
  }

  load(fileId: string) {
    const entry = this.entry(fileId);
    this.touch(entry);
    if (entry.url) return Promise.resolve(entry.url);
    if (entry.promise) return entry.promise;
    entry.promise = fetchApiBlob(`/v1/files/${fileId}/content`)
      .then(async (blob) => {
        const url = URL.createObjectURL(blob);
        const preloader = new Image();
        preloader.src = url;
        if (typeof preloader.decode === "function") {
          try {
            await preloader.decode();
          } catch {
            // Some valid formats cannot be decoded eagerly. The rendered img
            // still gets its normal load/error lifecycle below the cache.
          }
        }
        if (this.disposed) {
          URL.revokeObjectURL(url);
          throw new Error("图片缓存已释放");
        }
        entry.url = url;
        entry.promise = undefined;
        this.touch(entry);
        this.trim();
        return url;
      })
      .catch((error) => {
        entry.promise = undefined;
        if (!entry.url && entry.refs === 0) this.entries.delete(fileId);
        throw error;
      });
    return entry.promise;
  }

  clear() {
    this.disposed = true;
    for (const entry of this.entries.values())
      if (entry.url) URL.revokeObjectURL(entry.url);
    this.entries.clear();
  }

  private entry(fileId: string) {
    const current = this.entries.get(fileId);
    if (current) return current;
    const entry: StoryImageCacheEntry = { fileId, refs: 0 };
    this.entries.set(fileId, entry);
    return entry;
  }

  private touch(entry: StoryImageCacheEntry) {
    this.entries.delete(entry.fileId);
    this.entries.set(entry.fileId, entry);
  }

  private trim() {
    if (this.entries.size <= MAX_RETAINED_IMAGES) return;
    for (const [fileId, entry] of this.entries) {
      if (this.entries.size <= MAX_RETAINED_IMAGES) break;
      if (entry.refs > 0 || entry.promise) continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.entries.delete(fileId);
    }
  }
}

const StoryImageCacheContext = createContext<StoryImageCache | undefined>(
  undefined,
);

export function StoryImageCacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<StoryImageCache | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  if (!cacheRef.current) cacheRef.current = new StoryImageCache();
  useEffect(() => {
    if (cleanupTimerRef.current != null)
      globalThis.clearTimeout(cleanupTimerRef.current);
    const cache = cacheRef.current;
    return () => {
      // React Strict Mode immediately mounts effects again after its diagnostic
      // cleanup. Deferring disposal keeps that second mount on a valid cache.
      cleanupTimerRef.current = globalThis.setTimeout(() => cache?.clear(), 0);
    };
  }, []);
  return (
    <StoryImageCacheContext.Provider value={cacheRef.current}>
      {children}
    </StoryImageCacheContext.Provider>
  );
}

// This hook intentionally shares the provider's private cache with image
// renderers; keeping both here prevents a second public cache contract.
// eslint-disable-next-line react-refresh/only-export-components
export function useStoryImageCache() {
  return useContext(StoryImageCacheContext);
}
