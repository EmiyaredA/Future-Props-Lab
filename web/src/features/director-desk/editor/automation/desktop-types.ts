export interface DesktopResult<T = unknown> { ok: boolean; data?: T; error?: string }
declare global {
    interface Window { directorDesktop?: {
        files?(action: 'locations' | 'choose' | 'save-project' | 'save-export', data?: unknown): Promise<DesktopResult<{ projects?: string; exports?: string; saved?: boolean; filename?: string }>>;
        onSaveBeforeClose?(callback: () => Promise<boolean>): () => void;
        update(action: 'state' | 'save' | 'check' | 'download' | 'install' | 'page', data?: unknown): Promise<DesktopResult<import('../updates/types.ts').UpdateState>>;
        onUpdate(callback: (state: import('../updates/types.ts').UpdateState) => void): () => void;
        copyText?(text: string): Promise<DesktopResult>;
    } }
}
