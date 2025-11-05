import { Layer, Logger, LogLevel } from "effect";
import { HttpApiBuilder, HttpServer, Path, Etag } from "@effect/platform";
import {
  BunRuntime,
  BunFileSystem,
  BunHttpPlatform,
} from "@effect/platform-bun";

const ServerLive = HttpApiBuilder.serve().pipe(
  HttpServer.withLogAddress,
  Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
  // Layer.provide(TracingLayer),
  // Layer.provide(DevToolsLive),
  Layer.provide([
    BunFileSystem.layer,
    BunHttpPlatform.layer,
    Path.layer,
    Etag.layer,
  ]),
);

BunRuntime.runMain(Layer.launch(ServerLive), {
  disableErrorReporting: false,
});

