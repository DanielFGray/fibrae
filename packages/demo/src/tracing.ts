import { Layer, Logger, Effect } from "effect";
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { trace } from "@opentelemetry/api";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-web";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";

export const endpoint = "/__devServerLogger";
// const devServer = "http://localhost:5173";

class NetworkSpanExporter implements SpanExporter {
  private _isShutdown = false;

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this._isShutdown) {
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }

    const batchData = {
      type: "span_batch",
      count: spans.length,
      spans: spans.map((span) => ({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
        name: span.name,
        kind: span.kind,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status,
        attributes: span.attributes,
        events: span.events,
        links: span.links,
      })),
      source: "browser",
      timestamp: new Date().toISOString(),
    };

    const url = new URL(endpoint);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchData),
    })
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        globalThis.console.error("[SPAN-BATCH-EXPORT-FAILED]", error);
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  shutdown(): Promise<void> {
    this._isShutdown = true;
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    // Nothing to flush since we send immediately
    return Promise.resolve();
  }
}

// Manual tracing setup to avoid Node.js imports
const TracingLayer = Layer.scopedDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "didact",
        [ATTR_SERVICE_VERSION]: "0.1.0",
      });

      const processor = new BatchSpanProcessor(new NetworkSpanExporter(), {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 500,
        exportTimeoutMillis: 5000,
      });

      const provider = new WebTracerProvider({
        resource,
        spanProcessors: [processor],
      });

      provider.register();
      trace.setGlobalTracerProvider(provider);

      return provider;
    }),
    (provider) => Effect.promise(() => provider.shutdown()),
  ),
);

// Batched logger to reduce network overhead
let logBatch: any[] = [];
let batchTimer = -1;

const flushLogs = () => {
  if (logBatch.length === 0) return;

  const batchToSend = [...logBatch];
  logBatch = [];

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "log_batch",
      logs: batchToSend,
      count: batchToSend.length,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {
    globalThis.console.error("[NETWORK-LOG-BATCH-FAILED]", `Failed to send ${batchToSend.length} logs`);
  });
};

const networkLogger = Logger.make(
  ({ logLevel, message, annotations, spans }) => {
    const logData = {
      type: "log",
      level: logLevel.label,
      message: Array.isArray(message) ? message.join(" ") : message,
      timestamp: new Date().toISOString(),
      annotations,
      spans,
      source: "browser",
    };

    logBatch.push(logData);

    // Schedule batch send if not already scheduled
    if (batchTimer === -1) {
      batchTimer = globalThis.setTimeout(() => {
        flushLogs();
        batchTimer = -1;
      }, 1000) as unknown as number;
    }
  },
);

export const ViteDevServerDebugger = Layer.merge(
  Logger.replace(
    Logger.defaultLogger,
    Logger.zip(Logger.defaultLogger, networkLogger),
  ),
  TracingLayer,
);

