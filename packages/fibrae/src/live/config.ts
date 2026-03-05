import * as Context from "effect/Context"

export interface LiveConfigShape {
  readonly baseUrl: string
  readonly channels?: Record<string, string>
  readonly withCredentials?: boolean
}

export class LiveConfig extends Context.Tag("fibrae/LiveConfig")<
  LiveConfig,
  LiveConfigShape
>() {
  static make(options: LiveConfigShape): LiveConfigShape {
    return options
  }

  /** Resolve the SSE URL for a given event name. */
  static resolve(config: LiveConfigShape, event: string): string {
    return config.channels?.[event] ?? config.baseUrl
  }
}
