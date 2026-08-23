/** 协调浏览器 VAD 端点与服务端 speech.started，处理两者先后顺序不确定的情况。 */
export class VadEndpointCommitter {
  private turnId: string | null = null;
  private pending = false;
  private committed = new Set<string>();

  constructor(private sendCommit: (turnId: string) => void) {}

  userSpeechStarted(turnId: string) {
    this.turnId = turnId;
    if (this.pending) {
      this.pending = false;
      this.commit(turnId);
    }
  }

  speechEnded() {
    if (this.turnId) this.commit(this.turnId);
    else this.pending = true;
  }

  finishTurn() {
    this.turnId = null;
    this.pending = false;
  }

  reset() {
    this.turnId = null;
    this.pending = false;
    this.committed.clear();
  }

  private commit(turnId: string) {
    if (this.committed.has(turnId)) return;
    this.committed.add(turnId);
    this.sendCommit(turnId);
  }
}
