import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Data from "effect/Data";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Exit from "effect/Exit";
import * as Deferred from "effect/Deferred";
import {
  Atom as BaseAtom,
  Registry,
} from "@effect-atom/atom";
import { FiberSet } from "effect";

// Re-export Registry namespace for external use
export { Registry as AtomRegistry } from "@effect-atom/atom";

type Primitive = keyof HTMLElementTagNameMap | "TEXT_ELEMENT";

export type ElementType<Props = {}> =
  | Primitive
  | ((props: Props) => VElement | Stream.Stream<VElement, any, any> | Effect.Effect<VElement, any, any>);

export interface VElement {
  type: ElementType;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
}

export type FiberRef = { current: Fiber };

type ErrorBoundaryConfig = { fallback: VElement; onError?: (cause: unknown) => void; hasError: boolean };

export interface Fiber {
  type: Option.Option<ElementType>;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
  dom: Option.Option<Node>;
  parent: Option.Option<Fiber>;
  child: Option.Option<Fiber>;
  sibling: Option.Option<Fiber>;
  alternate: Option.Option<Fiber>;
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">;
  componentScope: Option.Option<Scope.Scope>;
  accessedAtoms: Option.Option<Set<BaseAtom.Atom<any>>>;
  latestStreamValue: Option.Option<VElement>;
  childFirstCommitDeferred: Option.Option<Deferred.Deferred<void>>;
  fiberRef: Option.Option<FiberRef>;
  isMultiEmissionStream: boolean;
  errorBoundary: Option.Option<ErrorBoundaryConfig>;
}

export class RenderError extends Data.TaggedError("RenderError") { }

export class FiberContext extends Effect.Tag("FiberContext")<
  FiberContext,
  { readonly fiber: Fiber }
>() { }

class AtomHandle<R, W = R> {
  private _registry: Option.Option<Registry.Registry> = Option.none();
  private readonly _atom: BaseAtom.Writable<R, W>;

  constructor(atom: BaseAtom.Writable<R, W>) {
    this._atom = atom;
  }

  _bindRegistry(registry: Registry.Registry): void {
    this._registry = Option.some(registry);
  }

  get(): Effect.Effect<R, never, Registry.AtomRegistry> {
    const self = this;
    return Effect.gen(function*() {
      const registry = yield* Registry.AtomRegistry;
      self._bindRegistry(registry);
      return registry.get(self._atom);
    });
  }

  set(value: W): Effect.Effect<void, never, Registry.AtomRegistry> {
    const self = this;
    return Effect.gen(function*() {
      const registry = yield* Registry.AtomRegistry;
      registry.set(self._atom, value);
    });
  }

  update(f: (r: R) => W): Effect.Effect<void, never, Registry.AtomRegistry> {
    const self = this;
    return Effect.gen(function*() {
      const registry = yield* Registry.AtomRegistry;
      registry.update(self._atom, f);
    });
  }

  modify<A>(f: (r: R) => [returnValue: A, nextValue: W]): Effect.Effect<A, never, Registry.AtomRegistry> {
    const self = this;
    return Effect.gen(function*() {
      const registry = yield* Registry.AtomRegistry;
      return registry.modify(self._atom, f);
    });
  }

  getSync(): R {
    return Option.match(this._registry, {
      onNone: () => {
        throw new Error("AtomHandle not bound to registry - ensure you call .get() in component render before using sync methods");
      },
      onSome: (registry) => registry.get(this._atom)
    });
  }

  setSync(value: W): void {
    Option.match(this._registry, {
      onNone: () => {
        throw new Error("AtomHandle not bound to registry - ensure you call .get() in component render before using sync methods");
      },
      onSome: (registry) => registry.set(this._atom, value)
    });
  }

  updateSync(f: (r: R) => W): void {
    Option.match(this._registry, {
      onNone: () => {
        throw new Error("AtomHandle not bound to registry - ensure you call .get() in component render before using sync methods");
      },
      onSome: (registry) => registry.update(this._atom, f)
    });
  }

  modifySync<A>(f: (r: R) => [returnValue: A, nextValue: W]): A {
    return Option.match(this._registry, {
      onNone: () => {
        throw new Error("AtomHandle not bound to registry - ensure you call .get() in component render before using sync methods");
      },
      onSome: (registry) => registry.modify(this._atom, f)
    });
  }

  get atom(): BaseAtom.Writable<R, W> {
    return this._atom;
  }
}

const normalizeToStream = (v: VElement | Effect.Effect<VElement> | Stream.Stream<VElement>): Stream.Stream<VElement> => {
  if (Effect.isEffect(v)) return Stream.fromEffect(v);
  if (typeof v === "object" && "pipe" in v && typeof v.pipe === "function") {
    return v as Stream.Stream<VElement>;
  }
  return Stream.succeed(v as VElement);
};

const makeTrackingRegistry = (
  realRegistry: Registry.Registry,
  accessedAtoms: Set<BaseAtom.Atom<any>>
): Registry.Registry => {
  return {
    [Registry.TypeId]: Registry.TypeId,
    getNodes: () => realRegistry.getNodes(),
    get: <A>(atom: BaseAtom.Atom<A>) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      accessedAtoms.add(actualAtom);
      return realRegistry.get(actualAtom);
    },
    mount: <A>(atom: BaseAtom.Atom<A>) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.mount(actualAtom);
    },
    refresh: <A>(atom: BaseAtom.Atom<A>) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.refresh(actualAtom);
    },
    set: <R, W>(atom: BaseAtom.Writable<R, W>, value: W) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.set(actualAtom, value);
    },
    setSerializable: (key: string, encoded: unknown) => realRegistry.setSerializable(key, encoded),
    modify: <R, W, A>(atom: BaseAtom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.modify(actualAtom, f);
    },
    update: <R, W>(atom: BaseAtom.Writable<R, W>, f: (_: R) => W) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.update(actualAtom, f);
    },
    subscribe: <A>(
      atom: BaseAtom.Atom<A>,
      f: (_: A) => void,
      options?: { readonly immediate?: boolean }
    ) => {
      const actualAtom = atom instanceof AtomHandle ? atom.atom : atom;
      return realRegistry.subscribe(actualAtom, f, options);
    },
    reset: () => realRegistry.reset(),
    dispose: () => realRegistry.dispose(),
  };
};

export const CustomAtomRegistryLayer = Registry.layerOptions({
  scheduleTask: (f: () => void) => f()
});

export class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  dependencies: [CustomAtomRegistryLayer],
  scoped: Effect.gen(function*() {
    const registry = yield* Registry.AtomRegistry;
    const runtimeScope = yield* Scope.make();

    const state = yield* Ref.make({
      currentRoot: Option.none<Fiber>(),
      wipRoot: Option.none<Fiber>(),
      nextUnitOfWork: Option.none<Fiber>(),
      deletions: [] as Fiber[],
      renderQueue: new Set<Fiber>(),
      batchScheduled: false,
      listenerStore: new WeakMap<HTMLElement, Record<string, EventListener>>(),
      atomHandleCache: new WeakMap<Fiber, Map<BaseAtom.Atom<any>, AtomHandle<any, any>>>(),
    });

    const runFork = yield* FiberSet.makeRuntime<Registry.AtomRegistry>();

    const AtomOps = {
      get: <A>(atom: BaseAtom.Atom<A>): A => registry.get(atom),
      set: <R, W>(atom: BaseAtom.Writable<R, W>, value: W): void => registry.set(atom, value),
      update: <R, W>(atom: BaseAtom.Writable<R, W>, f: (_: R) => W): void => registry.update(atom, f),
      modify: <R, W, A>(atom: BaseAtom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]): A => registry.modify(atom, f),
    };

    return { state, registry, runtimeScope, runFork, AtomOps };
  }),
}) {
  static Live = DidactRuntime.Default;
}

const queueFiberForRerender = Effect.fn("queueFiberForRerender")((fiber: Fiber) =>
  Effect.gen(function*() {
    const runtime = yield* DidactRuntime;
    const { state } = runtime;

    const didSchedule = yield* Ref.modify(state, (s) => {
      const alreadyQueued = s.renderQueue.has(fiber);
      const newQueue = alreadyQueued ? s.renderQueue : new Set([...s.renderQueue, fiber]);
      const shouldScheduleNow = !s.batchScheduled;
      const next = {
        ...s,
        renderQueue: newQueue,
        batchScheduled: s.batchScheduled || shouldScheduleNow,
      } as typeof s;
      return [shouldScheduleNow, next] as const;
    });

    if (didSchedule) {
      const { runFork, registry } = runtime;
      queueMicrotask(() => {
        runFork(
          processBatch().pipe(
            Effect.provideService(DidactRuntime, runtime),
            Effect.provideService(Registry.AtomRegistry, registry)
          )
        );
      });
    }
  })
);

const findNearestErrorBoundary = (fiber: Fiber): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = Option.some(fiber);
  while (Option.isSome(current)) {
    const f = current.value;
    if (Option.isSome(f.errorBoundary)) return Option.some(f);
    current = f.parent;
  }
  return Option.none<Fiber>();
};

const handleFiberError = Effect.fn("handleFiberError")((fiber: Fiber, cause: unknown) =>
  Effect.gen(function* () {
    const boundaryOpt = findNearestErrorBoundary(fiber);
    if (Option.isSome(boundaryOpt)) {
      const boundary = boundaryOpt.value;
      const cfg = Option.getOrElse(boundary.errorBoundary, () => ({ fallback: h("div", {}, []), hasError: false } as any));
      try { cfg.onError?.(cause); } catch { }
      cfg.hasError = true;
      boundary.errorBoundary = Option.some(cfg as any);
      yield* queueFiberForRerender(boundary);
    } else {
      yield* Effect.log(`[Error] Unhandled error without ErrorBoundary: ${String(cause)}`);
    }
  })
);

const processBatch = Effect.fn("processBatch")(() =>
  Effect.gen(function*() {
    const { state } = yield* DidactRuntime;
    const stateSnapshot = yield* Ref.get(state);

    const batch = Array.from(stateSnapshot.renderQueue);
    yield* Ref.update(state, (s) => ({
      ...s,
      renderQueue: new Set<Fiber>(),
      batchScheduled: false,
    }));

    if (batch.length === 0) {
      return;
    }

    yield* Option.match(stateSnapshot.currentRoot, {
      onNone: () => Effect.void,
      onSome: (currentRoot) => Effect.gen(function*() {
        yield* Ref.update(state, (s) => ({
          ...s,
          wipRoot: Option.some({
            type: currentRoot.type,
            dom: currentRoot.dom,
            props: currentRoot.props,
            parent: Option.none<Fiber>(),
            child: Option.none<Fiber>(),
            sibling: Option.none<Fiber>(),
            alternate: Option.some(currentRoot),
            effectTag: Option.none(),
            componentScope: Option.none(),
            accessedAtoms: Option.none(),
            latestStreamValue: Option.none(),
            childFirstCommitDeferred: Option.none(),
            fiberRef: Option.none(),
            isMultiEmissionStream: false,
            errorBoundary: Option.none(),
          }),
          deletions: [],
        }));

        const newState = yield* Ref.get(state);
        yield* Ref.update(state, (s) => ({
          ...s,
          nextUnitOfWork: newState.wipRoot,
        }));

        yield* workLoop();
      })
    });
  })
);

const resubscribeFiber = Effect.fn("resubscribeFiber")(
  (fiber: Fiber, accessedAtoms: Set<BaseAtom.Atom<any>>) =>
    Effect.gen(function*() {
      const runtime = yield* DidactRuntime;
      const { registry } = runtime;

      yield* Option.match(fiber.componentScope, {
        onNone: () => Effect.void,
        onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void)
      });

      const newScope = yield* Scope.make();
      fiber.componentScope = Option.some(newScope as Scope.Scope.Closeable);

      yield* Effect.forEach(
        accessedAtoms,
        (atom) => {
          const stream = Registry.toStream(registry, atom).pipe(
            Stream.drop(1),
            Stream.tap(() => Effect.log(`[Atom Change] Atom value changed, queueing rerender`))
          );
          const subscription = Stream.runForEach(
            stream,
            () => queueFiberForRerender(fiber).pipe(
              Effect.provideService(DidactRuntime, runtime)
            )
          );
          return Effect.forkIn(subscription, newScope);
        },
        { discard: true, concurrency: "unbounded" }
      );
    })
);

const performUnitOfWork: (fiber: Fiber) => Effect.Effect<Option.Option<Fiber>, never, DidactRuntime> =
  Effect.fn("performUnitOfWork")((fiber: Fiber) =>
    Effect.gen(function*() {
      const isFunctionComponent = Option.match(fiber.type, {
        onNone: () => false,
        onSome: (type) => typeof type === "function"
      });

      const typeName = Option.match(fiber.type, {
        onNone: () => "none",
        onSome: (type) => typeof type === "function" ? (type as Function).name || "anonymous" : String(type)
      });
      yield* Effect.log(`[performUnitOfWork] Processing fiber with type: ${typeName}, isFunction: ${isFunctionComponent}`);

      const eff = isFunctionComponent ? updateFunctionComponent(fiber) : updateHostComponent(fiber);
      const exited = yield* Effect.exit(eff);
      if (Exit.isFailure(exited)) {
        yield* handleFiberError(fiber, (exited as Exit.Failure<unknown>).cause);
        return Option.none<Fiber>();
      }

      if (Option.isSome(fiber.child)) {
        return fiber.child;
      }

      let currentFiber: Option.Option<Fiber> = Option.some(fiber);
      while (Option.isSome(currentFiber)) {
        if (Option.isSome(currentFiber.value.sibling)) {
          return currentFiber.value.sibling;
        }
        currentFiber = currentFiber.value.parent;
      }

      return Option.none<Fiber>();
    })
  );

const subscribeFiberAtoms = Effect.fn("subscribeFiberAtoms")(
  (fiber: Fiber, accessedAtoms: Set<BaseAtom.Atom<any>>) =>
    Effect.gen(function* () {
      const runtime = yield* DidactRuntime;
      const { registry } = runtime;

      const scope = yield* Option.match(fiber.componentScope, {
        onNone: () => Effect.die("subscribeFiberAtoms requires an existing componentScope"),
        onSome: (s) => Effect.succeed(s)
      });

      yield* Effect.forEach(
        accessedAtoms,
        (atom) => {
          const stream = Registry.toStream(registry, atom).pipe(
            Stream.drop(1),
            Stream.tap(() => Effect.log(`[Atom Change] Atom value changed, queueing rerender`))
          );
          const subscription = Stream.runForEach(
            stream,
            () => queueFiberForRerender(fiber).pipe(
              Effect.provideService(DidactRuntime, runtime)
            )
          );
          return Effect.forkIn(subscription, scope);
        },
        { discard: true, concurrency: "unbounded" }
      );
    })
);

const updateFunctionComponent = Effect.fn("updateFunctionComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    const runtime = yield* DidactRuntime;
    const { registry } = runtime;

    if (Option.isNone(fiber.childFirstCommitDeferred)) {
      fiber.childFirstCommitDeferred = Option.some(yield* Deferred.make<void>());
    }

    const hasAlternate = Option.isSome(fiber.alternate);
    const hasCachedValue = Option.match(fiber.alternate, {
      onNone: () => false,
      onSome: (alt) => Option.isSome(alt.latestStreamValue) && alt.isMultiEmissionStream
    });

    if (hasAlternate && hasCachedValue) {
      yield* Effect.log("[updateFunctionComponent] Using cached stream value from alternate");
      const alt = Option.getOrThrow(fiber.alternate);
      const vElement = Option.getOrThrow(alt.latestStreamValue);

      fiber.latestStreamValue = alt.latestStreamValue;
      fiber.accessedAtoms = alt.accessedAtoms;
      fiber.componentScope = alt.componentScope;
      alt.componentScope = Option.none();
      fiber.fiberRef = alt.fiberRef;
      Option.match(fiber.fiberRef, {
        onNone: () => { },
        onSome: (ref) => { ref.current = fiber; }
      });
      fiber.isMultiEmissionStream = alt.isMultiEmissionStream;

      yield* reconcileChildren(fiber, [vElement]);
      return;
    }

    fiber.props._atomCallIndex = 0;

    const accessedAtoms = new Set<BaseAtom.Atom<any>>();
    const trackingRegistry = makeTrackingRegistry(registry, accessedAtoms);

    const output = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("updateFunctionComponent called with no type"),
      onSome: (type) => {
        if (typeof type !== "function") {
          return Effect.die("updateFunctionComponent called with non-function type");
        }
        const component = type as ((props: any) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>);
        return Effect.sync(() => component(fiber.props));
      }
    });

    const isActualStream = typeof output === "object" &&
      output !== null &&
      Stream.StreamTypeId in output;
    fiber.isMultiEmissionStream = isActualStream;

    const stream = normalizeToStream(output).pipe(
      Stream.provideService(Registry.AtomRegistry, trackingRegistry),
      Stream.provideService(DidactRuntime, runtime),
      Stream.provideService(FiberContext, { fiber })
    );

    const firstValueDeferred = yield* Deferred.make<VElement>();

    fiber.accessedAtoms = Option.some(accessedAtoms);
    yield* resubscribeFiber(fiber, accessedAtoms);

    const scope = yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.die("Expected componentScope to be created by resubscribeFiber"),
      onSome: (s) => Effect.succeed(s)
    });

    const fiberRef: FiberRef = Option.match(fiber.fiberRef, {
      onNone: () => ({ current: fiber }),
      onSome: (ref) => ref
    });
    fiber.fiberRef = Option.some(fiberRef);

    const subscription = Stream.runForEach(stream, (vElement) =>
      Effect.gen(function*() {
        const done = yield* Deferred.isDone(firstValueDeferred);
        const currentFiber = fiberRef.current;
        if (!done) {
          yield* Deferred.succeed(firstValueDeferred, vElement);
        } else {
          currentFiber.latestStreamValue = Option.some(vElement);
          yield* queueFiberForRerender(currentFiber).pipe(
            Effect.provideService(DidactRuntime, runtime)
          );
        }
      })
    ).pipe(
      Effect.catchAllCause((cause) => Effect.gen(function*() {
        const done = yield* Deferred.isDone(firstValueDeferred);
        if (!done) {
          yield* Deferred.failCause(firstValueDeferred, cause);
        }
        const currentFiber = fiberRef.current;
        yield* handleFiberError(currentFiber, cause);
      })),
      Effect.tap(() => Effect.log("[Stream] Subscription completed"))
    );

    yield* Effect.forkIn(subscription, scope);

    const firstVElement = yield* Deferred.await(firstValueDeferred);

    fiber.latestStreamValue = Option.some(firstVElement);
    yield* reconcileChildren(fiber, [firstVElement]);

    yield* subscribeFiberAtoms(fiber, accessedAtoms);
  })
);

const updateHostComponent = Effect.fn("updateHostComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    if (Option.isNone(fiber.dom)) {
      fiber.dom = Option.some(yield* createDom(fiber));
    }

    const children = fiber.props.children as VElement[] | undefined;
    yield* reconcileChildren(fiber, children || []);
  })
);

const createDom = Effect.fn("createDom")((fiber: Fiber) =>
  Effect.gen(function*() {
    const dom = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("createDom called with no type"),
      onSome: (type) => {
        if (typeof type !== "string") {
          return Effect.die("createDom called on function component");
        }
        const node: Node = type === "TEXT_ELEMENT"
          ? document.createTextNode("")
          : document.createElement(type);
        return Effect.succeed(node);
      }
    });

    yield* updateDom(dom, {}, fiber.props, fiber);

    Option.match(
      Option.fromNullable(fiber.props.ref),
      {
        onNone: () => { },
        onSome: (ref) => {
          if (typeof ref === "object" && "current" in ref) {
            (ref as { current: Node | null }).current = dom;
          }
        }
      }
    );

    return dom;
  })
);

const isEvent = (key: string) => key.startsWith("on");
const isProperty = (key: string) => key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);
const isNew = (prev: { [key: string]: unknown }, next: { [key: string]: unknown }) => (key: string) =>
  prev[key] !== next[key];

const updateDom = Effect.fn("updateDom")(
  (dom: Node, prevProps: { [key: string]: unknown }, nextProps: { [key: string]: unknown }, ownerFiber?: Fiber) =>
    Effect.gen(function*() {
      const runtime = yield* DidactRuntime;
      const { runFork, state } = runtime;
      const element = dom as HTMLElement | Text;

      if (element instanceof Text) {
        if (nextProps.nodeValue !== prevProps.nodeValue) {
          element.nodeValue = String(nextProps.nodeValue ?? "");
        }
        return;
      }

      const stateSnapshot = yield* Ref.get(state);
      const el = element as HTMLElement;
      const stored = stateSnapshot.listenerStore.get(el) ?? {};

      const eventsToRemove = Object.keys(prevProps)
        .filter(isEvent)
        .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key));

      yield* Effect.forEach(eventsToRemove, (name) => Effect.sync(() => {
        const eventType = name.toLowerCase().substring(2);
        const wrapper = stored[eventType];
        if (wrapper) {
          el.removeEventListener(eventType, wrapper);
          delete stored[eventType];
        }
      }), { discard: true });

      Object.keys(nextProps)
        .filter(isProperty)
        .filter(isNew(prevProps, nextProps))
        .forEach((name) => {
          if (el instanceof HTMLElement) {
            const value = (nextProps as Record<string, unknown>)[name];
            if (name === "style" && typeof value === "string") {
              el.setAttribute("style", value);
            } else if (name === "class" || name === "className") {
              el.setAttribute("class", String(value ?? ""));
            } else if (name === "value") {
              if ("value" in el) {
                try { Reflect.set(el as object, "value", value as unknown); } catch { }
              } else {
                el.setAttribute("value", String(value ?? ""));
              }
            } else if (name === "checked") {
              if ("checked" in el) {
                try { Reflect.set(el as object, "checked", Boolean(value)); } catch { }
              } else if (value) {
                el.setAttribute("checked", "");
              } else {
                el.removeAttribute("checked");
              }
            } else if ((name as string).startsWith("data-") || (name as string).startsWith("aria-")) {
              el.setAttribute(name, String(value));
            } else {
              try { Reflect.set(el as object, name as PropertyKey, value as unknown); } catch { }
            }
          }
        });

      Object.keys(nextProps)
        .filter(isEvent)
        .filter(isNew(prevProps, nextProps))
        .forEach((name) => {
          const eventType = name.toLowerCase().substring(2);
          const handler = nextProps[name] as (event: Event) => unknown;

          const wrapper: EventListener = (event: Event) => {
            const result = handler(event);
            if (Effect.isEffect(result)) {
              const effectHandle = (result as Effect.Effect<unknown, unknown, any>).pipe(
                Effect.provideService(Registry.AtomRegistry, runtime.registry),
                Effect.provideService(DidactRuntime, runtime),
                Effect.catchAllCause((cause) => ownerFiber ? handleFiberError(ownerFiber, cause) : Effect.unit),
                Effect.asUnit
              ) as unknown as Effect.Effect<void, never, never>;
              runFork(effectHandle);
            }
          };

          const existing = stored[eventType];
          if (existing) {
            el.removeEventListener(eventType, existing);
          }
          el.addEventListener(eventType, wrapper);
          stored[eventType] = wrapper;
        });

      yield* Ref.update(state, (s) => {
        s.listenerStore.set(el, stored);
        return s;
      });
    })
);

const reconcileChildren = Effect.fn("reconcileChildren")(
  (wipFiber: Fiber, elements: VElement[]) =>
    Effect.gen(function*() {
      const { state } = yield* DidactRuntime;

      const oldChildren = yield* Option.match(wipFiber.alternate, {
        onNone: () => Effect.succeed([] as Fiber[]),
        onSome: (alternate) => Effect.iterate(alternate.child, {
          while: (opt): opt is Option.Some<Fiber> => Option.isSome(opt),
          body: (oldFiberOpt) => Effect.succeed(oldFiberOpt.value.sibling)
        }).pipe(
          Effect.map(() => {
            const result: Fiber[] = [];
            let current = alternate.child;
            while (Option.isSome(current)) {
              result.push(current.value);
              current = current.value.sibling;
            }
            return result;
          })
        )
      });

      const getKey = (props: { [key: string]: unknown } | undefined): Option.Option<unknown> =>
        Option.fromNullable(props ? (props as Record<string, unknown>).key : undefined);

      const oldByKey = new Map<unknown, Fiber>();
      const oldUnkeyed: Fiber[] = [];

      yield* Effect.forEach(oldChildren, (f) => Effect.sync(() => {
        const keyOpt = getKey(f.props as { [key: string]: unknown } | undefined);
        Option.match(keyOpt, {
          onNone: () => oldUnkeyed.push(f),
          onSome: (key) => oldByKey.set(key, f)
        });
      }), { discard: true });

      const newFibers: Fiber[] = [];

      yield* Effect.forEach(elements, (element) => Effect.gen(function*() {
        let matchedOldOpt: Option.Option<Fiber> = Option.none<Fiber>();
        const keyOpt = getKey(element.props as { [key: string]: unknown } | undefined);

        matchedOldOpt = Option.match(keyOpt, {
          onNone: () => Option.none<Fiber>(),
          onSome: (key) => {
            const maybe = Option.fromNullable(oldByKey.get(key));
            Option.match(maybe, {
              onNone: () => { },
              onSome: () => oldByKey.delete(key)
            });
            return maybe;
          }
        });

        if (Option.isNone(matchedOldOpt)) {
          const idx = oldUnkeyed.findIndex((f) => Option.match(f.type, {
            onNone: () => false,
            onSome: (fType) => fType === element.type
          }));
          if (idx >= 0) {
            matchedOldOpt = Option.some(oldUnkeyed[idx]);
            oldUnkeyed.splice(idx, 1);
          }
        }

        const fiber = yield* Option.match(matchedOldOpt, {
          onNone: () => Effect.succeed({
            type: Option.some(element.type),
            props: element.props,
            dom: Option.none<Node>(),
            parent: Option.some(wipFiber),
            child: Option.none<Fiber>(),
            sibling: Option.none<Fiber>(),
            alternate: Option.none<Fiber>(),
            effectTag: Option.some("PLACEMENT" as const),
            componentScope: Option.none(),
            accessedAtoms: Option.none(),
            latestStreamValue: Option.none(),
            childFirstCommitDeferred: Option.none(),
            fiberRef: Option.none(),
            isMultiEmissionStream: false,
            errorBoundary: Option.none(),
          }),
          onSome: (matched) => Effect.gen(function*() {
            const typeMatches = Option.match(matched.type, {
              onNone: () => false,
              onSome: (mType) => mType === element.type
            });

            if (typeMatches) {
              const newProps = { ...element.props };
              if (matched.props._atomCache) {
                newProps._atomCache = matched.props._atomCache;
              }

              return {
                type: matched.type,
                props: newProps,
                dom: matched.dom,
                parent: Option.some(wipFiber),
                child: Option.none<Fiber>(),
                sibling: Option.none<Fiber>(),
                alternate: matchedOldOpt,
                effectTag: Option.some("UPDATE" as const),
                componentScope: Option.none(),
                accessedAtoms: Option.none(),
                latestStreamValue: Option.none(),
                childFirstCommitDeferred: Option.none(),
                fiberRef: Option.none(),
                isMultiEmissionStream: false,
                errorBoundary: matched.errorBoundary,
              };
            } else {
              const fiberToDelete = matched;
              fiberToDelete.effectTag = Option.some("DELETION" as const);
              yield* Ref.update(state, (s) => ({ ...s, deletions: [...s.deletions, fiberToDelete] }));
              return {
                type: Option.some(element.type),
                props: element.props,
                dom: Option.none<Node>(),
                parent: Option.some(wipFiber),
                child: Option.none<Fiber>(),
                sibling: Option.none<Fiber>(),
                alternate: Option.none<Fiber>(),
                effectTag: Option.some("PLACEMENT" as const),
                componentScope: Option.none(),
                accessedAtoms: Option.none(),
                latestStreamValue: Option.none(),
                childFirstCommitDeferred: Option.none(),
                fiberRef: Option.none(),
                isMultiEmissionStream: false,
                errorBoundary: Option.none(),
              };
            }
          })
        });

        newFibers.push(fiber);
      }), { discard: true });

      const leftovers = [...oldByKey.values(), ...oldUnkeyed];
      yield* Effect.forEach(leftovers, (leftover) => Effect.gen(function*() {
        leftover.effectTag = Option.some("DELETION" as const);
        yield* Ref.update(state, (s) => ({ ...s, deletions: [...s.deletions, leftover] }));
      }), { discard: true });

      yield* Effect.forEach(newFibers, (nf, index) => Effect.sync(() => {
        if (index === 0) {
          wipFiber.child = Option.some(nf);
        } else if (index > 0) {
          newFibers[index - 1].sibling = Option.some(nf);
        }
      }), { discard: true });

      if (newFibers.length === 0) {
        wipFiber.child = Option.none<Fiber>();
      }
    }),
);

const deleteFiber: (fiber: Fiber) => Effect.Effect<void, never, never> =
  Effect.fn("deleteFiber")((fiber: Fiber) =>
    Effect.gen(function*() {
      yield* Option.match(fiber.componentScope, {
        onNone: () => Effect.void,
        onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void)
      });

      yield* Option.match(fiber.child, {
        onNone: () => Effect.void,
        onSome: (child) => deleteFiber(child)
      });
    })
  );

const commitDeletion: (fiber: Fiber, domParent: Node) => Effect.Effect<void, never, DidactRuntime> = Effect.fn("commitDeletion")((fiber: Fiber, domParent: Node) =>
  Effect.gen(function*() {
    yield* Option.match(fiber.dom, {
      onSome: (dom) => Effect.sync(() => domParent.removeChild(dom)),
      onNone: () => Effect.gen(function*() {
        yield* Effect.iterate(fiber.child, {
          while: (opt): opt is Option.Some<Fiber> => Option.isSome(opt),
          body: (childOpt) => Effect.gen(function*() {
            const child = childOpt.value;
            yield* commitDeletion(child, domParent);
            return child.sibling;
          })
        });
      })
    });
  }),
);

const commitRoot = Effect.fn("commitRoot")(() =>
  Effect.gen(function*() {
    const { state } = yield* DidactRuntime;
    const currentState = yield* Ref.get(state);

    yield* Effect.forEach(currentState.deletions, (fiber) => Effect.gen(function*() {
      const domParentFiber = yield* Effect.iterate(fiber.parent, {
        while: (parent) => Option.isSome(parent) && Option.match(parent, {
          onNone: () => false,
          onSome: (p) => Option.isNone(p.dom)
        }),
        body: (parent) => Effect.succeed(
          Option.flatMap(parent, (p) => p.parent)
        )
      });

      yield* Option.match(domParentFiber, {
        onNone: () => Effect.void,
        onSome: (parentFiber) => Option.match(parentFiber.dom, {
          onNone: () => Effect.void,
          onSome: (dom) => commitDeletion(fiber, dom)
        })
      });

      yield* deleteFiber(fiber);
    }), { discard: true });

    yield* Option.match(currentState.wipRoot, {
      onNone: () => Effect.void,
      onSome: (wipRoot) => Option.match(wipRoot.child, {
        onNone: () => Effect.void,
        onSome: (child) => commitWork(child)
      })
    });

    yield* Ref.update(state, (s) => ({
      ...s,
      currentRoot: currentState.wipRoot,
      wipRoot: Option.none(),
      deletions: [],
    }));
  })
);

const commitWork: (fiber: Fiber) => Effect.Effect<void, never, DidactRuntime> = Effect.fn("commitWork")((fiber: Fiber) =>
  Effect.gen(function*() {
    if (Option.isNone(fiber.dom)) {
      yield* Option.match(fiber.child, {
        onNone: () => Effect.void,
        onSome: (child) => commitWork(child)
      });
      yield* Option.match(fiber.sibling, {
        onNone: () => Effect.void,
        onSome: (sibling) => commitWork(sibling)
      });
      return;
    }

    const domParentFiber = yield* Effect.iterate(fiber.parent, {
      while: (parent) => Option.isSome(parent) && Option.match(parent, {
        onNone: () => false,
        onSome: (p) => Option.isNone(p.dom)
      }),
      body: (parent) => Effect.succeed(
        Option.flatMap(parent, (p) => p.parent)
      )
    });

    yield* Option.match(domParentFiber, {
      onNone: () => Effect.void,
      onSome: (parentFiber) => Option.match(parentFiber.dom, {
        onNone: () => Effect.void,
        onSome: (domParent) => Effect.gen(function*() {
          yield* Option.match(fiber.effectTag, {
            onNone: () => Effect.void,
            onSome: (tag) => Effect.gen(function*() {
              if (tag === "PLACEMENT") {
                yield* Option.match(fiber.dom, {
                  onNone: () => Effect.void,
                  onSome: (dom) => Effect.sync(() => domParent.appendChild(dom))
                });

                yield* Option.match(fiber.parent, {
                  onNone: () => Effect.void,
                  onSome: (parent) => Option.match(parent.childFirstCommitDeferred, {
                    onNone: () => Effect.void,
                    onSome: (deferred) => Effect.gen(function*() {
                      const done = yield* Deferred.isDone(deferred);
                      if (!done) {
                        yield* Deferred.succeed(deferred, undefined);
                      }
                    })
                  })
                });
              } else if (tag === "UPDATE") {
                const prevProps = Option.match(fiber.alternate, {
                  onNone: () => ({}),
                  onSome: (alt) => alt.props
                });
                yield* Option.match(fiber.dom, {
                  onNone: () => Effect.void,
                  onSome: (dom) => updateDom(dom, prevProps, fiber.props, fiber)
                });
              } else if (tag === "DELETION") {
                yield* commitDeletion(fiber, domParent);
                return;
              }
            })
          });
        })
      })
    });

    yield* Option.match(fiber.child, {
      onNone: () => Effect.void,
      onSome: (child) => commitWork(child)
    });
    yield* Option.match(fiber.sibling, {
      onNone: () => Effect.void,
      onSome: (sibling) => commitWork(sibling)
    });
  }),
);

const workLoop = Effect.fn("workLoop")(() =>
  Effect.gen(function*() {
    const { state } = yield* DidactRuntime;

    yield* Effect.iterate(yield* Ref.get(state), {
      while: (s) => Option.isSome(s.nextUnitOfWork),
      body: (currentState) => Effect.gen(function*() {
        const nextUnitOfWork = yield* Option.match(currentState.nextUnitOfWork, {
          onNone: () => Effect.succeed(Option.none<Fiber>()),
          onSome: (work) => performUnitOfWork(work)
        });
        yield* Ref.update(state, (s) => ({
          ...s,
          nextUnitOfWork: nextUnitOfWork,
        }));
        return yield* Ref.get(state);
      })
    });

    const finalState = yield* Ref.get(state);
    if (Option.isNone(finalState.nextUnitOfWork) && Option.isSome(finalState.wipRoot)) {
      yield* commitRoot();
    }
  }),
);

export function h<T>(
  type: Primitive,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => VElement | Stream.Stream<VElement, any, any>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => Effect.Effect<VElement, any, any>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: ElementType<T>,
  props: { [key: string]: unknown } = {},
  children: (VElement | string)[] = [],
): VElement {
  return {
    type: type as ElementType,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child),
      ),
    },
  };
}

const createTextElement = (text: string): VElement => ({
  type: "TEXT_ELEMENT",
  props: {
    nodeValue: text,
    children: [],
  },
});

export function render(element: VElement, container: HTMLElement): Effect.Effect<never, never, never>
export function render(element: VElement): (container: HTMLElement) => Effect.Effect<never, never, never>
export function render(
  element: VElement,
  container?: HTMLElement,
) {
  const program = (cont: HTMLElement) => Effect.gen(function*() {
    const { state } = yield* DidactRuntime;
    const currentState = yield* Ref.get(state);

    yield* Ref.update(state, (s) => ({
      ...s,
      wipRoot: Option.some({
        type: Option.none(),
        dom: Option.some(cont),
        props: {
          children: [element],
        },
        parent: Option.none<Fiber>(),
        child: Option.none<Fiber>(),
        sibling: Option.none<Fiber>(),
        alternate: currentState.currentRoot,
        effectTag: Option.none(),
        componentScope: Option.none(),
        accessedAtoms: Option.none(),
        latestStreamValue: Option.none(),
        childFirstCommitDeferred: Option.none(),
        fiberRef: Option.none(),
        isMultiEmissionStream: false,
        errorBoundary: Option.none(),
      }),
      deletions: [],
    }));

    const newState = yield* Ref.get(state);
    yield* Ref.update(state, (s) => ({
      ...s,
      nextUnitOfWork: newState.wipRoot,
    }));

    yield* workLoop();
    return yield* Effect.never;
  }).pipe(Effect.provide(DidactRuntime.Live));

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}

export const Atom = {
  make: <A>(initial: A): Effect.Effect<AtomHandle<A, A>, never, FiberContext> => {
    return Effect.gen(function*() {
      const { fiber } = yield* FiberContext;

      if (!fiber.props._atomCache) {
        fiber.props._atomCache = new Map<number, AtomHandle<any, any>>();
      }
      const cache = fiber.props._atomCache as Map<number, AtomHandle<any, any>>;

      if (fiber.props._atomCallIndex === undefined) {
        fiber.props._atomCallIndex = 0;
      }
      const index = fiber.props._atomCallIndex as number;
      fiber.props._atomCallIndex = index + 1;

      if (!cache.has(index)) {
        cache.set(index, new AtomHandle(BaseAtom.make(initial)));
      }

      return cache.get(index) as AtomHandle<A, A>;
    });
  },
} as const;

const getChildFirstCommitAwaiter = (fiber: Fiber): Effect.Effect<void> => {
  return Effect.gen(function*() {
    const deferred = yield* Option.match(fiber.childFirstCommitDeferred, {
      onNone: () => Effect.die("getChildFirstCommitAwaiter called on fiber without childFirstCommitDeferred"),
      onSome: (d) => Effect.succeed(d)
    });
    yield* Deferred.await(deferred);
  });
};

export const Suspense = (props: {
  fallback: VElement;
  children: VElement[];
}): Stream.Stream<VElement, never, FiberContext> => {
  if (!props.children || props.children.length === 0) {
    throw new Error("Suspense requires at least one child");
  }

  return Stream.unwrap(Effect.gen(function* () {
    const { fiber } = yield* FiberContext;
    const waitForChildCommit = getChildFirstCommitAwaiter(fiber);

    const childrenContainer = h("div", { style: "display: contents" }, props.children);

    return Stream.concat(
      Stream.succeed(props.fallback),
      Stream.fromEffect(waitForChildCommit).pipe(
        Stream.as(childrenContainer)
      )
    );
  }));
};

export const ErrorBoundary = (props: {
  fallback: VElement;
  onError?: (cause: unknown) => void;
  children: VElement[];
}): Stream.Stream<VElement, never, FiberContext> => {
  if (!props.children || props.children.length === 0) {
    throw new Error("ErrorBoundary requires at least one child");
  }

  return Stream.unwrap(Effect.gen(function* () {
    const { fiber } = yield* FiberContext;
    const existing = Option.getOrElse(fiber.errorBoundary, () => ({ fallback: props.fallback, hasError: false } as any));
    const cfg = { fallback: props.fallback, onError: props.onError ?? existing.onError, hasError: existing.hasError ?? false } as { fallback: VElement; onError?: (cause: unknown) => void; hasError: boolean };
    fiber.errorBoundary = Option.some(cfg);

    if (cfg.hasError) {
      return Stream.succeed(props.fallback);
    }

    const childrenContainer = h("div", { style: "display: contents" }, props.children);
    return Stream.succeed(childrenContainer);
  }));
};
