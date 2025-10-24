import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Data from "effect/Data";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Exit from "effect/Exit";
import {
  Atom as BaseAtom,
  Registry as AtomRegistry,
} from "@effect-atom/atom";
import { FiberSet } from "effect";

type Primitive = keyof HTMLElementTagNameMap | "TEXT_ELEMENT";

type ElementType<Props = {}> =
  | Primitive
  | ((props: Props) => VElement | Stream.Stream<VElement> | Effect.Effect<VElement, any, any>);

export interface VElement {
  type: ElementType;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
}

export interface Fiber {
  type?: ElementType;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
  dom: Option.Option<Node>;
  parent: Option.Option<Fiber>;
  child: Option.Option<Fiber>;
  sibling: Option.Option<Fiber>;
  alternate: Option.Option<Fiber>;
  effectTag?: "UPDATE" | "PLACEMENT" | "DELETION";
  componentScope?: Scope.Scope;
  accessedAtoms?: Set<BaseAtom.Atom<any>>;
  hooks?: unknown[];
  hookIndex?: number;
}

export class RenderError extends Data.TaggedError("RenderError") { }

// Global pointer to the fiber currently rendering (for hook-like memoization)
let currentRenderingFiber: Option.Option<Fiber> = Option.none<Fiber>();

const useMemo = <T>(init: () => T): T => {
  const fiberOpt = currentRenderingFiber;
  if (Option.isNone(fiberOpt)) return init();
  const fiber = fiberOpt.value;
  const hooks = fiber.hooks ?? (fiber.hooks = []);
  const index = fiber.hookIndex ?? 0;
  if (hooks[index] === undefined) {
    hooks[index] = init();
  }
  const value = hooks[index] as T;
  fiber.hookIndex = index + 1;
  return value;
};

// Normalize component output to Stream
const normalizeToStream = (v: VElement | Effect.Effect<VElement> | Stream.Stream<VElement>): Stream.Stream<VElement> => {
  if (Effect.isEffect(v)) return Stream.fromEffect(v);
  if (typeof v === "object" && "pipe" in v && typeof v.pipe === "function") {
    // Assume it's a Stream
    return v as Stream.Stream<VElement>;
  }
  return Stream.succeed(v as VElement);
};

// Create a tracking Registry proxy that records atom reads
const makeTrackingRegistry = (
  realRegistry: AtomRegistry.Registry,
  accessedAtoms: Set<BaseAtom.Atom<any>>
): AtomRegistry.Registry => {
  return {
    [AtomRegistry.TypeId]: AtomRegistry.TypeId,
    getNodes: () => realRegistry.getNodes(),
    get: <A>(atom: BaseAtom.Atom<A>) => {
      accessedAtoms.add(atom);
      return realRegistry.get(atom);
    },
    mount: <A>(atom: BaseAtom.Atom<A>) => realRegistry.mount(atom),
    refresh: <A>(atom: BaseAtom.Atom<A>) => realRegistry.refresh(atom),
    set: <R, W>(atom: BaseAtom.Writable<R, W>, value: W) => {
      return realRegistry.set(atom, value);
    },
    setSerializable: (key: string, encoded: unknown) => realRegistry.setSerializable(key, encoded),
    modify: <R, W, A>(atom: BaseAtom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]) => {
      return realRegistry.modify(atom, f);
    },
    update: <R, W>(atom: BaseAtom.Writable<R, W>, f: (_: R) => W) => {
      return realRegistry.update(atom, f);
    },
    subscribe: <A>(
      atom: BaseAtom.Atom<A>,
      f: (_: A) => void,
      options?: { readonly immediate?: boolean }
    ) => realRegistry.subscribe(atom, f, options),
    reset: () => realRegistry.reset(),
    dispose: () => realRegistry.dispose(),
  };
};

export class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  dependencies: [AtomRegistry.layer],
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
      processBatchCallback: null as null | (() => void),
    });

    // Create runFork that supports both AtomRegistry and DidactRuntime
    // We'll provide DidactRuntime later when calling runFork
    const runFork = yield* FiberSet.makeRuntime<AtomRegistry.AtomRegistry>();

    // Sync Atom helpers that use this runtime's registry
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

// Queue a fiber for rerender with deduplication and batching
const queueFiberForRerender = Effect.fn("queueFiberForRerender")((fiber: Fiber) =>
  Effect.gen(function*() {
    yield* Effect.logDebug(`[Queue] Fiber queued for rerender, type: ${String(fiber.type)}`);
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
      yield* Effect.log(`[Queue] Scheduling batch processing`);
      const { runFork, registry } = runtime;
      queueMicrotask(() => {
        runFork(
          processBatch().pipe(
            Effect.provideService(DidactRuntime, runtime),
            Effect.provideService(AtomRegistry.AtomRegistry, registry),
            Effect.tapError((err) => Effect.log(`[Batch] Error: ${String(err)}`))
          )
        );
      });
    } else {
      yield* Effect.logDebug(`[Queue] Already scheduled, just queued fiber if needed`);
    }
  })
);

// Process a batch of rerender requests
const processBatch = Effect.fn("processBatch")(() =>
  Effect.gen(function*() {
    yield* Effect.log(`[Batch] Starting batch processing`);
    const { state } = yield* DidactRuntime;
    const stateSnapshot = yield* Ref.get(state);

    // Snapshot and clear the queue
    const batch = Array.from(stateSnapshot.renderQueue);
    yield* Effect.log(`[Batch] Processing ${batch.length} fibers`);
    yield* Ref.update(state, (s) => ({
      ...s,
      renderQueue: new Set<Fiber>(),
      batchScheduled: false,
    }));

    if (batch.length === 0) {
      yield* Effect.log(`[Batch] No fibers to process, returning early`);
      return;
    }

    // For reactive updates: trigger a full re-render from the root
    // Create a new wipRoot from currentRoot and run the work loop
    if (Option.isNone(stateSnapshot.currentRoot)) {
      yield* Effect.log(`[Batch] No currentRoot, skipping batch`);
      return;
    }

    const currentRoot = stateSnapshot.currentRoot.value;
    yield* Effect.logDebug(`[Batch] Creating wipRoot for re-render`);

    // Create wipRoot with same structure as currentRoot
    // The alternate points to currentRoot for reconciliation
    yield* Effect.log(`[Batch] Creating wipRoot, currentRoot hasChild=${Option.isSome(currentRoot.child)}`);
    if (Option.isSome(currentRoot.child)) {
      const childType = typeof currentRoot.child.value.type === 'function' ? 'function' : String(currentRoot.child.value.type);
      yield* Effect.log(`[Batch] currentRoot.child type: ${childType}`);
    }
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
      }),
      deletions: [],
    }));

    const newState = yield* Ref.get(state);
    yield* Ref.update(state, (s) => ({
      ...s,
      nextUnitOfWork: newState.wipRoot,
    }));

    // Run the work loop to process all units of work
    yield* workLoop();

    yield* Effect.logDebug(`[Batch] Batch complete`);
  })
);

// Subscribe fiber to accessed atoms
const resubscribeFiber = Effect.fn("resubscribeFiber")(
  (fiber: Fiber, accessedAtoms: Set<BaseAtom.Atom<any>>) =>
    Effect.gen(function*() {
      yield* Effect.logDebug(`[Subscribe] Resubscribing fiber to ${accessedAtoms.size} atoms`);
      const runtime = yield* DidactRuntime;
      const { registry } = runtime;

      // Close existing subscriptions
      if (fiber.componentScope) {
        yield* Effect.logDebug(`[Subscribe] Closing existing scope`);
        yield* Scope.close(fiber.componentScope as Scope.Scope.Closeable, Exit.void);
      }

      // Create new component scope
      const newScope = yield* Scope.make();
      fiber.componentScope = newScope as Scope.Scope.Closeable;
      yield* Effect.logDebug(`[Subscribe] Created new scope`);

      // Subscribe to all accessed atoms in parallel
      const scope = fiber.componentScope;
      if (!scope) return;

      yield* Effect.forEach(
        accessedAtoms,
        (atom) => {
          const stream = AtomRegistry.toStream(registry, atom).pipe(
            // Avoid triggering rerender from the initial emission on subscribe
            Stream.drop(1)
          );
          const subscription = Stream.runForEach(
            stream,
            (_value) => {
              return Effect.gen(function*() {

                yield* queueFiberForRerender(fiber).pipe(
                  Effect.provideService(DidactRuntime, runtime)
                );
              });
            }
          );
          return Effect.forkIn(subscription, scope);
        },
        { discard: true, concurrency: "unbounded" }
      );
      yield* Effect.logDebug(`[Subscribe] All subscriptions created`);
    })
);

const performUnitOfWork: (fiber: Fiber) => Effect.Effect<Option.Option<Fiber>, never, DidactRuntime> =
  Effect.fn("performUnitOfWork")((fiber: Fiber) =>
    Effect.gen(function*() {
      const isFunctionComponent = typeof fiber.type === "function";

      if (isFunctionComponent) {
        yield* updateFunctionComponent(fiber);
      } else {
        yield* updateHostComponent(fiber);
      }

      // Return next unit of work
      if (Option.isSome(fiber.child)) {
        return fiber.child;
      }

      let nextFiber = Option.some(fiber);
      while (Option.isSome(nextFiber)) {
        if (Option.isSome(nextFiber.value.sibling)) {
          return nextFiber.value.sibling;
        }
        nextFiber = nextFiber.value.parent;
      }

      return Option.none<Fiber>();
    })
  );

const updateFunctionComponent = Effect.fn("updateFunctionComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    yield* Effect.logDebug(`[FnComponent] Updating function component: ${String(fiber.type)}`);
    const { registry } = yield* DidactRuntime;

    // Initialize hooks from alternate if present to persist memoized values
    const prevHooks = Option.isSome(fiber.alternate) && fiber.alternate.value.hooks
      ? (fiber.alternate.value.hooks as unknown[])
      : [];
    fiber.hooks = [...prevHooks];
    fiber.hookIndex = 0;

    // Track accessed atoms
    const accessedAtoms = new Set<BaseAtom.Atom<any>>();
    const trackingRegistry = makeTrackingRegistry(registry, accessedAtoms);

    // Call component to get output with hook context
    if (typeof fiber.type !== "function") {
      return;
    }
    const component = fiber.type as ((props: any) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>);
    let output: VElement | Effect.Effect<VElement> | Stream.Stream<VElement>;
    try {
      currentRenderingFiber = Option.some(fiber);
      output = component(fiber.props);
    } finally {
      currentRenderingFiber = Option.none();
    }

    // Normalize to stream
    const stream = normalizeToStream(output);

    // Run stream under tracking registry to get latest VElement
    const vElement = yield* Stream.runLast(stream).pipe(
      Effect.provideService(AtomRegistry.AtomRegistry, trackingRegistry),
      Effect.map(Option.getOrThrow)
    );

    yield* Effect.logDebug(`[FnComponent] Tracked ${accessedAtoms.size} atoms`);

    // Update subscriptions
    fiber.accessedAtoms = accessedAtoms;
    yield* resubscribeFiber(fiber, accessedAtoms);

    // Reconcile children
    yield* reconcileChildren(fiber, [vElement]);
  })
);

const updateHostComponent = Effect.fn("updateHostComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    // Create DOM if not exists
    if (Option.isNone(fiber.dom)) {
      fiber.dom = Option.some(yield* createDom(fiber));
    }

    // Reconcile children
    const children = fiber.props.children as VElement[] | undefined;
    yield* reconcileChildren(fiber, children || []);
  })
);

const createDom = Effect.fn("createDom")((fiber: Fiber) =>
  Effect.gen(function*() {
    // Only create DOM for host components (string types), not function components
    if (typeof fiber.type !== "string") {
      return yield* Effect.die("createDom called on function component");
    }

    const dom: Node = fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);

    yield* updateDom(dom, {}, fiber.props);

    // Attach DOM to ref if provided
    const ref = fiber.props.ref;
    if (ref && typeof ref === "object" && "current" in ref) {
      (ref as { current: Node | null }).current = dom;
    }

    return dom;
  })
);

const isEvent = (key: string) => key.startsWith("on");
const isProperty = (key: string) => key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);
const isNew = (prev: { [key: string]: unknown }, next: { [key: string]: unknown }) => (key: string) =>
  prev[key] !== next[key];

// Track DOM event listeners to allow proper removal on updates
const listenerStore: WeakMap<HTMLElement, Record<string, EventListener>> = new WeakMap();

const updateDom = Effect.fn("updateDom")(
  (dom: Node, prevProps: { [key: string]: unknown }, nextProps: { [key: string]: unknown }) =>
    Effect.gen(function*() {
      yield* Effect.logDebug(`[updateDom] node=${dom.nodeName}, prevPropsKeys=${Object.keys(prevProps).join(',')}, nextPropsKeys=${Object.keys(nextProps).join(',')}`);

      const runtime = yield* DidactRuntime;
      const { runFork } = runtime;
      const element = dom as HTMLElement | Text;

      // Handle text nodes specially
      if (element instanceof Text) {
        if (nextProps.nodeValue !== prevProps.nodeValue) {
          element.nodeValue = String(nextProps.nodeValue ?? "");
        }
        return;
      }

      // Ensure listener store exists for this element
      const el = element as HTMLElement;
      const stored = listenerStore.get(el) ?? {};



      // Remove old or changed event listeners using stored wrappers
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

      // Set new or changed properties
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
                try { Reflect.set(el as object, "value", value as unknown); } catch { /* ignore */ }
              } else {
                el.setAttribute("value", String(value ?? ""));
              }
            } else if (name === "checked") {
              if ("checked" in el) {
                try { Reflect.set(el as object, "checked", Boolean(value)); } catch { /* ignore */ }
              } else if (value) {
                el.setAttribute("checked", "");
              } else {
                el.removeAttribute("checked");
              }
            } else if ((name as string).startsWith("data-") || (name as string).startsWith("aria-")) {
              el.setAttribute(name, String(value));
            } else {
              try { Reflect.set(el as object, name as PropertyKey, value as unknown); } catch { /* ignore */ }
            }
          }
        });

      // Add new or changed event listeners
      Object.keys(nextProps)
        .filter(isEvent)
        .filter(isNew(prevProps, nextProps))
        .forEach((name) => {
          const eventType = name.toLowerCase().substring(2);
          const handler = nextProps[name] as (event: Event) => unknown;

          // Create wrapper that auto-runs Effect results
          const wrapper: EventListener = (event: Event) => {
            const result = handler(event);
            if (Effect.isEffect(result)) {
              const effectHandle = Effect.gen(function*() {
                yield* Effect.logDebug(`[Event] ${eventType} handler called on ${el.tagName}[data-cy=${el.getAttribute('data-cy')}]`);
                yield* result;
              }).pipe(
                Effect.provideService(AtomRegistry.AtomRegistry, runtime.registry),
                Effect.tapError((err) => Effect.logError(`[Event] Effect handler failed for ${eventType}: ${String(err)}`))
              ) as Effect.Effect<void, unknown, never>;
              runFork(effectHandle);
            }
          };

          // Remove existing wrapper for this eventType if present, then attach
          const existing = stored[eventType];
          if (existing) {
            el.removeEventListener(eventType, existing);
          }
          el.addEventListener(eventType, wrapper);
          stored[eventType] = wrapper;
        });

      // Persist listener store for this element
      listenerStore.set(el, stored);
    })
);

const reconcileChildren = Effect.fn("reconcileChildren")(
  (wipFiber: Fiber, elements: VElement[]) =>
    Effect.gen(function*() {
      const { state } = yield* DidactRuntime;

      // Gather old children from alternate
      const oldChildren: Fiber[] = [];
      let oldFiberOpt = Option.isSome(wipFiber.alternate) ? wipFiber.alternate.value.child : Option.none<Fiber>();
      while (Option.isSome(oldFiberOpt)) {
        oldChildren.push(oldFiberOpt.value);
        oldFiberOpt = oldFiberOpt.value.sibling;
      }
      yield* Effect.logDebug(`[Reconcile] wipType=${String(wipFiber.type)}, hasAlternate=${Option.isSome(wipFiber.alternate)}, oldChildrenCount=${oldChildren.length}, newElementsCount=${elements.length}`);

      const getKey = (props: { [key: string]: unknown } | undefined): Option.Option<unknown> =>
        Option.fromNullable(props ? (props as Record<string, unknown>).key : undefined);

      // Build lookup maps for keyed and unkeyed old children
      const oldByKey = new Map<unknown, Fiber>();
      const oldUnkeyed: Fiber[] = [];
      for (const f of oldChildren) {
        const keyOpt = getKey(f.props as { [key: string]: unknown } | undefined);
        if (Option.isSome(keyOpt)) oldByKey.set(keyOpt.value, f);
        else oldUnkeyed.push(f);
      }

      const newFibers: Fiber[] = [];

      for (const element of elements) {
        let matchedOldOpt: Option.Option<Fiber> = Option.none<Fiber>();
        const keyOpt = getKey(element.props as { [key: string]: unknown } | undefined);
        if (Option.isSome(keyOpt)) {
          const maybe = Option.fromNullable(oldByKey.get(keyOpt.value));
          if (Option.isSome(maybe)) {
            matchedOldOpt = maybe;
            oldByKey.delete(keyOpt.value);
          }
        }
        if (Option.isNone(matchedOldOpt)) {
          // Find first unkeyed with same type
          yield* Effect.logDebug(`[Reconcile] Looking for unkeyed match, elementType=${String(element.type).substring(0, 60)}, oldUnkeyedCount=${oldUnkeyed.length}`);
          if (oldUnkeyed.length > 0) {
            yield* Effect.logDebug(`[Reconcile] Old unkeyed types: ${oldUnkeyed.map((f, i) => `[${i}]=${String(f.type).substring(0, 40)}`).join(', ')}`);
            yield* Effect.logDebug(`[Reconcile] Checking type equality: newType===oldType[0]? ${element.type === oldUnkeyed[0].type}`);
          }
          const idx = oldUnkeyed.findIndex((f) => f.type === element.type);
          if (idx >= 0) {
            matchedOldOpt = Option.some(oldUnkeyed[idx]);
            oldUnkeyed.splice(idx, 1);
            yield* Effect.logDebug(`[Reconcile] Found unkeyed match at index ${idx}`);
          } else {
            yield* Effect.logDebug(`[Reconcile] No unkeyed match found`);
          }
        }

        let fiber: Fiber;
        if (Option.isSome(matchedOldOpt) && matchedOldOpt.value.type === element.type) {
          yield* Effect.logDebug(`[Reconcile] UPDATE: type=${String(element.type)}, key=${Option.isSome(keyOpt) ? keyOpt.value : 'none'}`);
          fiber = {
            type: matchedOldOpt.value.type,
            props: element.props,
            dom: matchedOldOpt.value.dom,
            parent: Option.some(wipFiber),
            child: Option.none<Fiber>(),
            sibling: Option.none<Fiber>(),
            alternate: matchedOldOpt,
            effectTag: "UPDATE",
          };
        } else {
          yield* Effect.logDebug(`[Reconcile] PLACEMENT: type=${String(element.type)}, key=${Option.isSome(keyOpt) ? keyOpt.value : 'none'}, hadMatch=${Option.isSome(matchedOldOpt)}`);
          fiber = {
            type: element.type,
            props: element.props,
            dom: Option.none<Node>(),
            parent: Option.some(wipFiber),
            child: Option.none<Fiber>(),
            sibling: Option.none<Fiber>(),
            alternate: Option.none<Fiber>(),
            effectTag: "PLACEMENT",
          };
          if (Option.isSome(matchedOldOpt)) {
            // Type changed for keyed/position-matched old; mark old for deletion
            const fiberToDelete = matchedOldOpt.value;
            fiberToDelete.effectTag = "DELETION";
            yield* Ref.update(state, (s) => ({ ...s, deletions: [...s.deletions, fiberToDelete] }));
          }
        }
        newFibers.push(fiber);
      }

      // Any remaining old children were not matched -> deletions
      const leftovers = [...oldByKey.values(), ...oldUnkeyed];
      yield* Effect.logDebug(`[Reconcile] Marking ${leftovers.length} leftovers for DELETION`);
      for (const leftover of leftovers) {
        yield* Effect.logDebug(`[Reconcile] DELETION: type=${String(leftover.type)}, key=${getKey(leftover.props as any)}`);
        leftover.effectTag = "DELETION";
        yield* Ref.update(state, (s) => ({ ...s, deletions: [...s.deletions, leftover] }));
      }

      // Link the new fibers as child/sibling list
      let prevSibling = Option.none<Fiber>();
      for (let i = 0; i < newFibers.length; i++) {
        const nf = newFibers[i];
        if (i === 0) {
          wipFiber.child = Option.some(nf);
        } else if (Option.isSome(prevSibling)) {
          prevSibling.value.sibling = Option.some(nf);
        }
        prevSibling = Option.some(nf);
      }
      if (newFibers.length === 0) {
        wipFiber.child = Option.none<Fiber>();
      }
    }),
);

const deleteFiber: (fiber: Fiber) => Effect.Effect<void, never, never> =
  Effect.fn("deleteFiber")((fiber: Fiber) =>
    Effect.gen(function*() {
      // Close component scope to cleanup subscriptions
      if (fiber.componentScope) {
        yield* Scope.close(fiber.componentScope as Scope.Scope.Closeable, Exit.void);
      }

      // Recursively delete children
      if (Option.isSome(fiber.child)) {
        yield* deleteFiber(fiber.child.value);
      }
    })
  );

const commitDeletion: (fiber: Fiber, domParent: Node) => Effect.Effect<void, never, DidactRuntime> = Effect.fn("commitDeletion")((fiber: Fiber, domParent: Node) =>
  Effect.gen(function*() {
    if (Option.isSome(fiber.dom)) {
      // This fiber has a DOM node - remove it
      domParent.removeChild(fiber.dom.value);
    } else {
      // Function component (no DOM) - find and remove all DOM descendants
      // We need to traverse the entire subtree to find all DOM nodes
      let child = fiber.child;
      while (Option.isSome(child)) {
        yield* commitDeletion(child.value, domParent);
        child = child.value.sibling;
      }
    }
  }),
);

const commitRoot = Effect.fn("commitRoot")(() =>
  Effect.gen(function*() {
    const { state } = yield* DidactRuntime;
    const currentState = yield* Ref.get(state);

    // Delete fibers
    for (const fiber of currentState.deletions) {
      // Find the DOM parent for this deletion
      let domParentFiber = fiber.parent;
      while (Option.isSome(domParentFiber) && Option.isNone(domParentFiber.value.dom)) {
        domParentFiber = domParentFiber.value.parent;
      }

      if (Option.isSome(domParentFiber) && Option.isSome(domParentFiber.value.dom)) {
        yield* commitDeletion(fiber, domParentFiber.value.dom.value);
      }

      // Clean up scopes and subscriptions
      yield* deleteFiber(fiber);
    }

    if (Option.isSome(currentState.wipRoot) && Option.isSome(currentState.wipRoot.value.child)) {
      yield* commitWork(currentState.wipRoot.value.child.value);
    }

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


    // If this fiber has no DOM (function component), skip DOM operations
    // and just recurse to children
    if (Option.isNone(fiber.dom)) {
      yield* Effect.logDebug(`[Commit] No DOM, recursing to children`);
      if (Option.isSome(fiber.child)) {
        yield* commitWork(fiber.child.value);
      }
      if (Option.isSome(fiber.sibling)) {
        yield* commitWork(fiber.sibling.value);
      }
      return;
    }

    // This is a host component (has DOM) - find its DOM parent
    let domParentFiber = fiber.parent;
    while (Option.isSome(domParentFiber) && Option.isNone(domParentFiber.value.dom)) {
      domParentFiber = domParentFiber.value.parent;
    }

    if (Option.isNone(domParentFiber)) {
      yield* Effect.logDebug(`[Commit] No DOM parent found, skipping`);
      return;
    }

    const domParent = domParentFiber.value.dom;

    if (fiber.effectTag === "PLACEMENT" && Option.isSome(domParent)) {
      yield* Effect.logDebug(`[Commit] PLACEMENT: appending ${String(fiber.type)} to parent`);
      domParent.value.appendChild(fiber.dom.value);
    } else if (fiber.effectTag === "UPDATE") {
      const prevProps = Option.isSome(fiber.alternate) ? fiber.alternate.value.props : {};
      yield* Effect.logDebug(`[Commit UPDATE] type=${String(fiber.type)}, hasAlternate=${Option.isSome(fiber.alternate)}, prevPropsKeys=${Object.keys(prevProps).join(',')}, nextPropsKeys=${Object.keys(fiber.props).join(',')}`);
      yield* updateDom(
        fiber.dom.value,
        prevProps,
        fiber.props,
      );
    } else if (fiber.effectTag === "DELETION" && Option.isSome(domParent)) {
      yield* Effect.logDebug(`[Commit] DELETION: removing ${String(fiber.type)}`);
      yield* commitDeletion(fiber, domParent.value);
      return; // Don't process children/siblings for deletions
    }


    if (Option.isSome(fiber.child)) {
      yield* commitWork(fiber.child.value);
    }
    if (Option.isSome(fiber.sibling)) {
      yield* commitWork(fiber.sibling.value);
    }
  }),
);

const workLoop = Effect.fn("workLoop")(() =>
  Effect.gen(function*() {
    const { state } = yield* DidactRuntime;
    let currentState = yield* Ref.get(state);

    while (Option.isSome(currentState.nextUnitOfWork)) {
      const nextUnitOfWork = yield* performUnitOfWork(currentState.nextUnitOfWork.value);
      yield* Ref.update(state, (s) => ({
        ...s,
        nextUnitOfWork: nextUnitOfWork,
      }));
      currentState = yield* Ref.get(state);
    }

    if (Option.isNone(currentState.nextUnitOfWork) && Option.isSome(currentState.wipRoot)) {
      yield* commitRoot();
    }
  }),
);

// Helper to create VElement
export function h<T>(
  type: Primitive,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => VElement | Stream.Stream<VElement>,
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
        type: undefined,
        dom: Option.some(cont),
        props: {
          children: [element],
        },
        parent: Option.none<Fiber>(),
        child: Option.none<Fiber>(),
        sibling: Option.none<Fiber>(),
        alternate: currentState.currentRoot,
      }),
      deletions: [],
    }));

    const newState = yield* Ref.get(state);
    yield* Ref.update(state, (s) => ({
      ...s,
      nextUnitOfWork: newState.wipRoot,
    }));

    yield* workLoop();
    // Keep runtime alive for event handlers and reactive updates
    return yield* Effect.never;
  }).pipe(Effect.provide(DidactRuntime.Live));

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}

// Atom wrapper ensuring per-fiber memoized instances + Effect-based ops
export const Atom = {
  make: <A>(initial: A): BaseAtom.Writable<A, A> => {
    return useMemo(() => BaseAtom.make(initial));
  },
  get: <A>(atom: BaseAtom.Atom<A>): Effect.Effect<A, never, AtomRegistry.AtomRegistry> =>
    Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry;
      return registry.get(atom);
    }),
  set: <R, W>(atom: BaseAtom.Writable<R, W>, value: W): Effect.Effect<void, never, AtomRegistry.AtomRegistry> =>
    Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry;
      return registry.set(atom, value);
    }),
  update: <R, W>(atom: BaseAtom.Writable<R, W>, f: (_: R) => W): Effect.Effect<void, never, AtomRegistry.AtomRegistry> =>
    Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry;
      return registry.update(atom, f);
    }),
  modify: <R, W, A>(atom: BaseAtom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]): Effect.Effect<A, never, AtomRegistry.AtomRegistry> =>
    Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry;
      return registry.modify(atom, f);
    }),
} as const;

export { AtomRegistry };

