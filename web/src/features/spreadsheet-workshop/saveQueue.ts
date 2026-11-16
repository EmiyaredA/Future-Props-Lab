import type { Document, Project, Save } from "./api";
import { stable } from "./codec";

/** Serialize CAS writes; an uncertain write retries the original request verbatim. */
export class SaveQueue {
  project: Project;
  draft: { title: string; document: Document };
  error: unknown;
  saving = false;
  private saved: string;
  private current: string;
  private pending?: Save;
  private inFlight?: Promise<Project>;
  private active = true;
  private listeners = new Set<() => void>();

  constructor(
    project: Project,
    private write: (body: Save) => Promise<Project>,
  ) {
    this.project = project;
    this.draft = { title: project.title, document: project.document };
    this.current = this.identity();
    this.saved = this.current;
  }
  private identity() {
    return this.draft.title + "\n" + stable(this.draft.document);
  }
  get dirty() {
    return this.current !== this.saved;
  }
  subscribe(listener: () => void) {
    this.active = true;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    if (this.active) this.listeners.forEach((fn) => fn());
  }
  update(title: string, document: Document) {
    const current = title + "\n" + stable(document);
    if (current === this.current) return;
    this.current = current;
    this.draft = { title, document };
    this.emit();
  }
  dispose() {
    this.active = false;
    this.listeners.clear();
  }
  acceptNavigation() {
    this.saved = this.current;
    this.pending = undefined;
  }
  async flush(): Promise<Project> {
    if (this.inFlight) {
      await this.inFlight;
      return this.flush();
    }
    if (!this.dirty && !this.pending) return this.project;
    this.pending ||= {
      request_id: crypto.randomUUID(),
      expected_revision: this.project.revision,
      title: this.draft.title,
      document: structuredClone(this.draft.document),
      calculated: true,
    };
    const body = this.pending;
    this.saving = true;
    this.error = undefined;
    this.emit();
    const promise = this.write(body);
    this.inFlight = promise;
    try {
      const result = await promise;
      this.project = result;
      this.saved = body.title + "\n" + stable(body.document);
      this.pending = undefined;
    } catch (error) {
      this.error = error;
      throw error;
    } finally {
      this.saving = false;
      this.inFlight = undefined;
      this.emit();
    }
    return this.active && this.dirty ? this.flush() : this.project;
  }
}
