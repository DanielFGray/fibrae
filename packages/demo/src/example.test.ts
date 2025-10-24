import { Effect } from "effect";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";

describe("Example @effect/vitest tests", () => {
	// Basic test with Effect
	it.effect("should run a simple Effect", () =>
		Effect.gen(function* () {
			const result = yield* Effect.succeed(42);
			expect(result).toBe(42);
		}),
	);

	// Test with Effect.sync
	it.effect("should handle sync effects", () =>
		Effect.gen(function* () {
			const value = yield* Effect.sync(() => "hello world");
			expect(value).toBe("hello world");
		}),
	);

	// Test with failure handling
	it.effect("should handle errors", () =>
		Effect.gen(function* () {
			const result = yield* Effect.fail("error").pipe(
				Effect.catchAll((error) => Effect.succeed(`caught: ${error}`)),
			);
			expect(result).toBe("caught: error");
		}),
	);

	// Test with async operations (using promise instead of Effect.sleep for simplicity)
	it.effect("should handle async effects", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				Promise.resolve("delayed value"),
			);
			expect(result).toBe("delayed value");
		}),
	);
});
