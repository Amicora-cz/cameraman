/**
 * Minimal obs-websocket v5 client (OBS Studio >= 28, >= 30.2 recommended).
 *
 * Deliberately without `obs-websocket-js`: for the three requests used here the
 * protocol is trivial, and Node 22 has both `WebSocket` and `crypto` built in,
 * so this adds no npm dependency.
 *
 * Protocol: the server sends Hello (op 0) with a challenge/salt, the client
 * answers Identify (op 1) with a signature, the server confirms Identified
 * (op 2). Requests are op 6, responses op 7.
 */
import { createHash } from "node:crypto";

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
};

function sign(password: string, salt: string, challenge: string): string {
  const secret = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secret + challenge).digest("base64");
}

export class ObsClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(
    private readonly url: string,
    private readonly password: string,
  ) {}

  async connect(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      throw new Error("Node 22+ is required for the global WebSocket API.");
    }
    const socket = new WebSocket(this.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const fail = (message: string) => () =>
        reject(
          new Error(
            `${message} (${this.url}). Is OBS running with ` +
              "Tools -> WebSocket Server Settings -> Enable WebSocket server?",
          ),
        );
      socket.addEventListener("error", fail("Cannot connect to OBS"), { once: true });
      socket.addEventListener("close", fail("The OBS connection closed"), { once: true });

      socket.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as {
          op: number;
          d: Record<string, any>;
        };

        if (frame.op === 0) {
          const auth = frame.d.authentication as
            | { challenge: string; salt: string }
            | undefined;
          const identify: Record<string, unknown> = {
            rpcVersion: frame.d.rpcVersion ?? 1,
          };
          if (auth) {
            if (!this.password) {
              reject(new Error("OBS requires a password — set OBS_WS_PASSWORD."));
              return;
            }
            identify.authentication = sign(this.password, auth.salt, auth.challenge);
          }
          socket.send(JSON.stringify({ op: 1, d: identify }));
          return;
        }

        if (frame.op === 2) {
          resolve();
          return;
        }

        if (frame.op === 7) {
          const id = String(frame.d.requestId);
          const waiter = this.pending.get(id);
          if (!waiter) return;
          this.pending.delete(id);
          const status = frame.d.requestStatus as { result: boolean; comment?: string };
          if (status?.result) {
            waiter.resolve((frame.d.responseData ?? {}) as Record<string, unknown>);
          } else {
            waiter.reject(
              new Error(`OBS request failed: ${status?.comment ?? "no reason given"}`),
            );
          }
        }
      });
    });
  }

  private request(
    requestType: string,
    requestData: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket) throw new Error("ObsClient.connect() was never called.");
    const requestId = `gverify-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new Error(`OBS did not answer ${requestType} within 10s.`));
        }
      }, 10_000);
    });
  }

  async startRecord(): Promise<void> {
    const status = await this.request("GetRecordStatus");
    if (status.outputActive) {
      throw new Error("OBS is already recording. Stop it and run again.");
    }
    await this.request("StartRecord");
  }

  /** Returns the path OBS wrote. */
  async stopRecord(): Promise<string> {
    const data = await this.request("StopRecord");
    return String(data.outputPath ?? "");
  }

  /** MP4 chapter marker (OBS >= 30.2); silently skipped on older builds. */
  async chapter(name: string): Promise<void> {
    try {
      await this.request("CreateRecordChapter", { chapterName: name });
    } catch {
      // Older OBS does not know this request — chapters are nice-to-have.
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
