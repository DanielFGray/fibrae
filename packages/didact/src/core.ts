import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Data from "effect/Data";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Exit from "effect/Exit";
import * as Deferred from "effect/Deferred";
import * as FiberSet from "effect/FiberSet";

import {
  Atom,
  Registry as AtomRegistry,
} from "@effect-atom/atom";
import {
  type VElement,
  type ElementType,
  type Fiber,
  type FiberRef,
  type ErrorBoundaryConfig,
  type Primitive,
  isStream,
} from "./shared.js";

// Re-export shared types for backwards compatibility
export type { VElement, ElementType, Fiber, FiberRef, Primitive };
export type { ErrorBoundaryConfig };

// Alias for convenience (matches common React terminology)
export type VNode = VElement;

export class RenderError extends Data.TaggedError("RenderError") { }

export class FiberContext extends Effect.Tag("FiberContext")<
  FiberContext,
  { readonly fiber: Fiber }
>() { }


const normalizeToStream = (v: VElement | Effect.Effect<VElement> | Stream.Stream<VElement>): Stream.Stream<VElement> => {
  if (Effect.isEffect(v)) return Stream.fromEffect(v);
  if (isStream(v)) return v;
  return Stream.succeed(v);
};

const makeTrackingRegistry = (
  realRegistry: AtomRegistry.Registry,
  accessedAtoms: Set<Atom.Atom<any>>
): AtomRegistry.Registry => {
  return new Proxy(realRegistry as object, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (atom: Atom.Atom<any>) => {
          // Track accessed atom
          accessedAtoms.add(atom);
          // Forward to real registry

          return realRegistry.get(atom);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  }) as AtomRegistry.Registry;
};

export const CustomAtomRegistryLayer = AtomRegistry.layerOptions({
  scheduleTask: (f: () => void) => f()
});

export class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  dependencies: [CustomAtomRegistryLayer],
  scoped: Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const runtimeScope = yield* Scope.make();

    const state = yield* Ref.make({
      currentRoot: Option.none<Fiber>(),
      wipRoot: Option.none<Fiber>(),
      nextUnitOfWork: Option.none<Fiber>(),
      deletions: [] as Fiber[],
      renderQueue: new Set<Fiber>(),
      batchScheduled: false,
      listenerStore: new WeakMap<HTMLElement, Record<string, EventListener>>(),
    });

    const runFork = yield* FiberSet.makeRuntime<AtomRegistry.AtomRegistry>();

    const AtomOps = {
      get: <A>(atom: Atom.Atom<A>): A => registry.get(atom),
      set: <R, W>(atom: Atom.Writable<R, W>, value: W): void => registry.set(atom, value),
      update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W): void => registry.update(atom, f),
      modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]): A => registry.modify(atom, f),
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
            Effect.provideService(AtomRegistry.AtomRegistry, registry)
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
  Effect.gen(function*() {
    const boundaryOpt = findNearestErrorBoundary(fiber);
    if (Option.isSome(boundaryOpt)) {
      const boundary = boundaryOpt.value;
      const cfg: ErrorBoundaryConfig = Option.getOrElse(boundary.errorBoundary, () => ({ fallback: h("div", {}, []), hasError: false }));
      const wasAlreadyError = cfg.hasError === true;
      try { cfg.onError?.(cause); } catch { }
      cfg.hasError = true;
      boundary.errorBoundary = Option.some(cfg);
      if (!wasAlreadyError) {
        yield* queueFiberForRerender(boundary);
      }
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

Effect.fn("resubscribeFiber")(
  (fiber: Fiber, accessedAtoms: Set<Atom.Atom<any>>) =>
    Effect.gen(function*() {
      const runtime = yield* DidactRuntime;
      const { registry } = runtime;

      yield* Option.match(fiber.componentScope, {
        onNone: () => Effect.void,
        onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void)
      });

      const newScope = yield* Scope.make();
      fiber.componentScope = Option.some(newScope);

      yield* Effect.forEach(
        accessedAtoms,
        (atom) => {
          const stream = AtomRegistry.toStream(registry, atom).pipe(
            Stream.drop(1),
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

      const eff = isFunctionComponent ? updateFunctionComponent(fiber) : updateHostComponent(fiber);
      const exited = yield* Effect.exit(eff);
      if (Exit.isFailure(exited)) {
        yield* handleFiberError(fiber, exited.cause);
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

    // If this fiber is an ErrorBoundary in error state, we MUST recompute
    // to allow rendering the fallback. Skips the cached fast-path.
    const isBoundaryWithError = Option.isSome(fiber.errorBoundary) && fiber.errorBoundary.value.hasError === true;

    if (hasAlternate && hasCachedValue && !isBoundaryWithError) {
      const alt = Option.getOrThrow(fiber.alternate);

      // Get the LATEST stream value BEFORE updating fiberRef
      // If fiberRef exists, stream emissions may have updated the OLD fiber's latestStreamValue
      const latestValue = Option.match(alt.fiberRef, {
        onNone: () => alt.latestStreamValue,
        onSome: (ref) => ref.current.latestStreamValue
      });
      const vElement = Option.getOrThrow(latestValue);

      // Now update fiberRef so any NEW emissions update this new fiber
      fiber.fiberRef = alt.fiberRef;
      Option.match(fiber.fiberRef, {
        onNone: () => { },
        onSome: (ref) => { ref.current = fiber; }
      });

      fiber.latestStreamValue = latestValue;
      fiber.accessedAtoms = alt.accessedAtoms;
      fiber.componentScope = alt.componentScope;
      alt.componentScope = Option.none();
      fiber.isMultiEmissionStream = alt.isMultiEmissionStream;

      yield* reconcileChildren(fiber, [vElement]);
      return;
    }


    const accessedAtoms = new Set<Atom.Atom<any>>();
    const trackingRegistry = makeTrackingRegistry(registry, accessedAtoms);

    const output = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("updateFunctionComponent called with no type"),
      onSome: (type) => {
        if (typeof type !== "function") {
          return Effect.die("updateFunctionComponent called with non-function type");
        }
        const component = type as ((props: any) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>);
        return Effect.provideService(AtomRegistry.AtomRegistry, trackingRegistry)(
          Effect.sync(() => component(fiber.props))
        );
      }
    });

    const isActualStream = typeof output === "object" &&
      output !== null &&
      Stream.StreamTypeId in output;
    fiber.isMultiEmissionStream = isActualStream;

    const stream = normalizeToStream(output).pipe(
      Stream.provideService(AtomRegistry.AtomRegistry, trackingRegistry),
      Stream.provideService(DidactRuntime, runtime),
      Stream.provideService(FiberContext, { fiber })
    );

    const firstValueDeferred = yield* Deferred.make<VElement>();

    // Capture accessed atoms container now; subscribe after first emission
    fiber.accessedAtoms = Option.some(accessedAtoms);

    // Prepare (or replace) component scope before starting the component stream
    yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.void,
      onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void)
    });
    const newScope = yield* Scope.make();
    fiber.componentScope = Option.some(newScope);
    const scope = newScope;

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
    );

    yield* Effect.forkIn(subscription, scope);

    const firstVElement = yield* Deferred.await(firstValueDeferred);

    // After first render, subscribe to accessed atoms within existing scope
    yield* Effect.forEach(
      accessedAtoms,
      (atom) => {
        const stream = AtomRegistry.toStream(registry, atom).pipe(
          Stream.drop(1),
        );
        const sub = Stream.runForEach(
          stream,
          () => queueFiberForRerender(fiber).pipe(
            Effect.provideService(DidactRuntime, runtime)
          )
        );
        return Effect.forkIn(sub, scope);
      },
      { discard: true, concurrency: "unbounded" }
    );

    fiber.latestStreamValue = Option.some(firstVElement);
    yield* reconcileChildren(fiber, [firstVElement]);

  })
);

const updateHostComponent = Effect.fn("updateHostComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    // FRAGMENT does not create a DOM node; just reconcile children
    const isFragment = Option.match(fiber.type, {
      onNone: () => false,
      onSome: (t) => t === "FRAGMENT"
    });

    if (!isFragment) {
      if (Option.isNone(fiber.dom)) {
        fiber.dom = Option.some(yield* createDom(fiber));
      }
    }

    const children = fiber.props.children;
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
        if (type === "FRAGMENT") {
          return Effect.die("createDom called on fragment");
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
            (ref).current = dom;
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

const propertyUpdateMap: Record<string, "attribute" | "property" | "classList" | "booleanAttribute"> = {
  // style: "attribute",
  class: "classList",
  className: "classList",
  value: "property",
  checked: "property",
  // Add more as needed
};

function setDomProperty(el: HTMLElement, name: string, value: any): void {
  const method = propertyUpdateMap[name] ||
    (name.startsWith("data-") || name.startsWith("aria-") ? "attribute" : "attribute");

  switch (method) {
    case "attribute":
      return el.setAttribute(name, String(value ?? ""));
    case "property":
      return void Reflect.set(el, name, value);
    case "classList":
      if (Array.isArray(value)) {
        return value.forEach((v: string) => el.classList.add(v));
      }
      return el.setAttribute("class", String(value ?? ""));
    case "booleanAttribute":
      if (value) {
        el.setAttribute(name, "");
        return
      } else {
        el.removeAttribute(name);
        return
      }
    default:
      return el.setAttribute(name, String(value ?? ""));
  }
}

const updateDom = Effect.fn("updateDom")(
  (dom: Node, prevProps: { [key: string]: unknown }, nextProps: { [key: string]: unknown }, ownerFiber: Fiber) =>
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
      const el = element;
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

      yield* Effect.sync(() => {
        Object.keys(nextProps)
          .filter(isProperty)
          .filter(isNew(prevProps, nextProps))
          .forEach((name) => {
            if (el instanceof HTMLElement) {
              setDomProperty(el, name, nextProps[name]);
            }
          });
      });

      const eventKeys = Object.keys(nextProps).filter(isEvent).filter(isNew(prevProps, nextProps));

      yield* Effect.sync(() => {
        eventKeys.forEach((name) => {
          const eventType = name.toLowerCase().substring(2);
          const handler = nextProps[name] as (event: Event) => unknown;

          const wrapper: EventListener = (event: Event) => {
            const result = handler(event);
            if (Effect.isEffect(result)) {
              const effectHandle = (result as Effect.Effect<unknown, unknown, any>).pipe(
                Effect.provideService(AtomRegistry.AtomRegistry, runtime.registry),
                Effect.provideService(DidactRuntime, runtime),
                Effect.catchAllCause((cause) => {
                  return Effect.gen(function*() {
                    if (ownerFiber) {
                      yield* handleFiberError(ownerFiber, cause);
                    }
                  });
                })
              );
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

      yield* Effect.forEach(elements, (element, childIndex) => Effect.gen(function*() {
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

              const updatedFiber = {
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
              return updatedFiber;
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

        // Assign deterministic _dxPath for hydration. Root uses '' path.
        const parentPath = (wipFiber.props && typeof wipFiber.props._dxPath === 'string') ? (wipFiber.props._dxPath) : '';
        const childPath = parentPath === '' ? `p:${childIndex}` : `${parentPath}.${childIndex}`;
        fiber.props._dxPath = childPath;

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

const commitDeletion: (fiber: Fiber, domParent: Node) =>
  Effect.Effect<void, never, DidactRuntime> = Effect.fn("commitDeletion")((fiber: Fiber, domParent: Node) =>
    Option.match(fiber.dom, {
      onSome: (dom) => Effect.sync(() => domParent.removeChild(dom)),
      onNone: () => Effect.iterate(fiber.child, {
        while: (opt): opt is Option.Some<Fiber> => Option.isSome(opt),
        body: (childOpt) => Effect.gen(function*() {
          const child = childOpt.value;
          yield* commitDeletion(child, domParent);
          return child.sibling;
        })
      })
    })
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
        onSome: (domParent) => Option.match(fiber.effectTag, {
          onNone: () => Effect.void,
          onSome: (tag) => Effect.gen(function*() {
            if (tag === "PLACEMENT") {
              yield* Option.match(fiber.dom, {
                onNone: () => Effect.void,
                onSome: (dom) => Effect.sync(() => domParent.appendChild(dom))
              });

              // Gated Suspense resolution: only when a real child in the
              // Suspense children branch commits (not fallback, not container)
              yield* Effect.gen(function*() {
                // Walk ancestors to determine branch context and locate boundary
                let current: Option.Option<Fiber> = Option.some(fiber);
                let inFallbackBranch = false;
                let inHiddenChildrenBranch = false;
                let childrenContainer: Option.Option<Fiber> = Option.none<Fiber>();
                let nearestSuspense: Option.Option<Fiber> = Option.none<Fiber>();

                while (Option.isSome(current)) {
                  const f = current.value;

                  // Detect Suspense boundary by boundary marker set in Suspense
                  if (Option.isNone(nearestSuspense)) {
                    const boundaryMarker = f.props && f.props["data-dx-suspense-boundary"];
                    if (boundaryMarker === true) {
                      nearestSuspense = current;
                    }
                  }

                  // Detect branch markers on host/fragment fibers
                  const branchProp = f.props && f.props["data-dx-suspense"];
                  const marker = typeof branchProp === "string" ? branchProp : undefined;
                  if (marker === "fallback") {
                    inFallbackBranch = true;
                  } else if (marker === "children-hidden") {
                    if (!inHiddenChildrenBranch) {
                      inHiddenChildrenBranch = true;
                      childrenContainer = current;
                    }
                  } else if (marker === "children-visible") {
                    // Track visible children branch (used for debug logging)
                    if (Option.isNone(childrenContainer)) {
                      childrenContainer = current;
                    }
                  }

                  current = f.parent;
                }

                // Compute container placement match before early returns (for logging)
                const isContainerPlacement = Option.match(childrenContainer, {
                  onNone: () => false,
                  onSome: (c) => c === fiber
                });

                if (!inHiddenChildrenBranch || inFallbackBranch || isContainerPlacement) {
                  return;
                }

                // Resolve the nearest Suspense boundary only (once)
                yield* Option.match(nearestSuspense, {
                  onNone: () => Effect.void,
                  onSome: (boundary) => Effect.gen(function*() {
                    const deferredOpt = boundary.childFirstCommitDeferred;
                    if (Option.isSome(deferredOpt)) {
                      const done = yield* Deferred.isDone(deferredOpt.value);
                      if (!done) {
                        const runtime = yield* DidactRuntime;
                        yield* Effect.sync(() => {
                          setTimeout(() => {
                            runtime.runFork(Deferred.succeed(deferredOpt.value, undefined));
                          }, 0);
                        });
                      }
                    }
                  })
                });
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



export const Suspense = (props: {
  fallback: VElement;
  children?: VElement | VElement[];
}): Stream.Stream<VElement, never, FiberContext> => {
  const childrenArray = Array.isArray(props.children) ? props.children : props.children ? [props.children] : [];

  if (childrenArray.length === 0) {
    throw new Error("Suspense requires at least one child");
  }

  const containerVisible = h("div", { style: "display: contents", key: "suspense-children", "data-dx-suspense": "children-visible" }, childrenArray);
  const fallbackWrapped = h("div", { "data-dx-suspense": "fallback" }, [props.fallback]);

  // First emission: fallback only
  const first = h("FRAGMENT", {}, [fallbackWrapped]);

  return Stream.concat(
    Stream.succeed(first),
    // Switch to visible children on next macrotask to ensure fallback is observable
    Stream.fromEffect(Effect.async<unknown, never, never>((resume) => {
      const id = setTimeout(() => resume(Effect.succeed(undefined)), 0);
      return Effect.sync(() => clearTimeout(id));
    })).pipe(
      Stream.as(h("FRAGMENT", {}, [containerVisible])),
    )
  );
};

export const ErrorBoundary = (props: {
  fallback: VElement;
  onError?: (cause: unknown) => void;
  children?: VElement | VElement[];
}): Stream.Stream<VElement, never, FiberContext> => {
  const childrenArray = Array.isArray(props.children) ? props.children : props.children ? [props.children] : [];
  if (childrenArray.length === 0) {
    throw new Error("ErrorBoundary requires at least one child");
  }

  return Stream.unwrap(Effect.gen(function*() {
    const { fiber } = yield* FiberContext;

    // Check if we already have an error boundary config (e.g., from handleFiberError mutation)
    const existingCfg = Option.getOrUndefined(fiber.errorBoundary);

    // If we already have a config (possibly mutated by error handler), preserve it
    // Only update fallback/onError but keep hasError state
    const cfg: ErrorBoundaryConfig = existingCfg ? {
      fallback: props.fallback,
      onError: props.onError,
      hasError: existingCfg.hasError  // Preserve the hasError state from mutation
    } : {
      fallback: props.fallback,
      onError: props.onError,
      hasError: false  // Initial state
    };

    fiber.errorBoundary = Option.some(cfg);

    if (cfg.hasError) {
      return Stream.succeed(props.fallback);
    }

    const childrenContainer = h("div", { style: "display: contents" }, childrenArray);
    return Stream.succeed(childrenContainer);
  }));
};
