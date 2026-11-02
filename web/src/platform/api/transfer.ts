/** Per-request transfer measurements. No process-wide request or credential state. */
export type TransferProgress = {
  direction: "upload" | "download";
  phase: "transferring" | "processing" | "completed";
  loaded: number;
  total?: number;
  bytesPerSecond: number;
};
export type TransferOptions = {
  onProgress?: (progress: TransferProgress) => void;
};
export type TransferRequestInit = RequestInit & TransferOptions;

/** Capture the serializer's FormData before Request serializes it. No file reparse/copy. */
export function createUploadTransfer(
  onProgress?: TransferOptions["onProgress"],
) {
  let body: FormData | undefined;
  return {
    capture(value: FormData) {
      body = value;
      return value;
    },
    fetch(request: Request) {
      if (!onProgress) return fetch(request);
      if (!body) return Promise.reject(new Error("上传内容尚未准备好"));
      return uploadRequest(request, body, onProgress);
    },
  };
}

function meter(
  direction: TransferProgress["direction"],
  onProgress: TransferOptions["onProgress"],
) {
  let lastTime = performance.now();
  let lastLoaded = 0;
  let speed = 0;
  return (
    loaded: number,
    total?: number,
    phase: TransferProgress["phase"] = "transferring",
  ) => {
    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed >= 200 || phase !== "transferring") {
      speed =
        elapsed > 0 ? Math.max(0, ((loaded - lastLoaded) * 1000) / elapsed) : 0;
      lastTime = now;
      lastLoaded = loaded;
    }
    onProgress?.({ direction, phase, loaded, total, bytesPerSecond: speed });
  };
}

/** Count decoded response bytes only against a comparable (uncompressed) length. */
export function measureResponse(
  response: Response,
  onProgress?: TransferOptions["onProgress"],
): Response {
  if (
    !onProgress ||
    !response.body ||
    !response.ok ||
    response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;
  const length = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  let total =
    (!encoding || encoding === "identity") && length > 0 ? length : undefined;
  const report = meter("download", onProgress);
  const reader = response.body.getReader();
  let loaded = 0;
  report(0, total);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          report(loaded, total, "completed");
          controller.close();
          reader.releaseLock();
        } else {
          loaded += next.value.byteLength;
          if (total != null && loaded > total) total = undefined;
          report(loaded, total);
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      reader.releaseLock();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** openapi-fetch's per-call fetch adapter retains its typed serialization/middleware. */
export function transferFetch(onProgress?: TransferOptions["onProgress"]) {
  return async (request: Request): Promise<Response> => {
    if (!onProgress) return fetch(request);
    if (
      !request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      return measureResponse(await fetch(request), onProgress);
    }
    // Request.formData() retains Blob/File backing stores; do not copy large files to ArrayBuffers.
    const form = await request.formData();
    return uploadRequest(request, form, onProgress);
  };
}

export function uploadRequest(
  request: Request,
  body: FormData,
  onProgress?: TransferOptions["onProgress"],
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const report = meter("upload", onProgress);
    let loaded = 0;
    let total: number | undefined;
    const abort = () => {
      xhr.abort();
      reject(new DOMException("请求已取消", "AbortError"));
    };
    if (request.signal.aborted) {
      abort();
      return;
    }
    xhr.open(request.method, request.url);
    xhr.withCredentials = request.credentials === "include";
    xhr.responseType = "blob";
    request.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "content-type")
        xhr.setRequestHeader(key, value);
    });
    request.signal.addEventListener("abort", abort, { once: true });
    const cleanup = () => request.signal.removeEventListener("abort", abort);
    xhr.upload.onprogress = (event) => {
      loaded = event.loaded;
      total = event.lengthComputable ? event.total : undefined;
      report(loaded, total);
    };
    xhr.upload.onload = () => report(loaded, total, "processing");
    xhr.onload = () => {
      cleanup();
      const headers = new Headers();
      xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .filter(Boolean)
        .forEach((line) => {
          const colon = line.indexOf(":");
          if (colon > 0)
            headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
        });
      if (xhr.status >= 200 && xhr.status < 300)
        report(loaded, total, "completed");
      resolve(
        new Response(
          [204, 205, 304].includes(xhr.status) ? null : xhr.response,
          { status: xhr.status, statusText: xhr.statusText, headers },
        ),
      );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError("网络连接失败，请检查网络后重试"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("请求已取消", "AbortError"));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new TypeError("上传超时，请重试"));
    };
    report(0);
    xhr.send(body);
  });
}
