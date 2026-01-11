import { DurableObject, exports, RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';

// Log entry from a tail event
export interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
}

// RPC-compatible object that holds log waiter state
class LogWaiter extends RpcTarget {
  private logs: LogEntry[] = [];
  private resolve: ((logs: LogEntry[]) => void) | undefined = undefined;

  addLogs(logs: LogEntry[]) {
    this.logs.push(...logs);
    if (this.resolve) {
      this.resolve(this.logs);
      this.resolve = undefined;
    }
  }

  async getLogs(timeoutMs: number): Promise<LogEntry[]> {
    // If logs already arrived, return them immediately
    if (this.logs.length > 0) {
      return this.logs;
    }

    // Wait for logs to arrive with timeout
    return new Promise<LogEntry[]>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(this.logs);
      }, timeoutMs);

      this.resolve = (logs) => {
        clearTimeout(timeout);
        resolve(logs);
      };
    });
  }
}

// Durable Object that stores logs for a specific worker
export class LogSession extends DurableObject {
  private waiter: LogWaiter | null = null;

  // Called by the tail worker to add logs
  async addLogs(logs: LogEntry[]) {
    if (this.waiter) {
      this.waiter.addLogs(logs);
    }
  }

  // Called by the main handler to set up log collection
  // Returns a LogWaiter that can be used to get logs later
  async waitForLogs(): Promise<LogWaiter> {
    this.waiter = new LogWaiter();
    return this.waiter;
  }
}

interface LogTailerProps {
  workerName: string;
}

// Tail worker entrypoint that receives logs and sends them to the DO
export class LogTailer extends WorkerEntrypoint<never, LogTailerProps> {
  override async tail(events: TraceItem[]) {
    const logSessionStub = exports.LogSession.getByName(this.ctx.props.workerName);

    for (const event of events) {
      const logs: LogEntry[] = event.logs.map((log: TraceLog) => ({
        level: log.level,
        message: Array.isArray(log.message)
          ? log.message
              .map((m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m)))
              .join(' ')
          : typeof log.message === 'string'
            ? log.message
            : JSON.stringify(log.message),
        timestamp: log.timestamp,
      }));

      if (logs.length > 0) {
        await logSessionStub.addLogs(logs);
      }
    }
  }
}
