type ElementType = string | ((props: Props) => DidactElement);

interface Props {
  [key: string]: any;
  children?: DidactElement[];
}

interface DidactElement {
  type: ElementType;
  props: Props;
}

interface Hook {
  state?: any;
  queue?: ((state: any) => any)[];
  effect?: {
    callback: () => (() => void) | void;
    deps?: any[];
    cleanup?: () => void;
  };
  ref?: { current: any };
}

interface Fiber {
  type: ElementType;
  props: Props;
  dom: Node | null;
  parent: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  effectTag?: "PLACEMENT" | "UPDATE" | "DELETION";
  hooks?: Hook[];
  effects?: Hook[];
}

export function createElement(
  type: ElementType,
  props: Props = {},
  children: (DidactElement | string | number)[] = [],
): DidactElement {
  return {
    type,
    props: {
      ...props,
      children: children.flatMap((child) =>
        !child || typeof child !== "object" ? createTextElement(child) : child,
      ),
    },
  };
}

export const h = createElement;

function createTextElement(
  text: string | number | boolean | null | undefined,
): DidactElement {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber: Fiber): Node {
  const dom =
    fiber.type == "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type as string);

  updateDom(dom, {}, fiber.props);

  // Attach DOM to ref if provided
  if (
    fiber.props?.ref &&
    typeof fiber.props.ref === "object" &&
    "current" in fiber.props.ref
  ) {
    fiber.props.ref.current = dom;
  }

  return dom;
}

function updateDom(dom: Node, prevProps: Props, nextProps: Props = {}): void {
  const element = dom as HTMLElement;

  // Process all keys in a single loop
  const allKeys = new Set([
    ...Object.keys(prevProps),
    ...Object.keys(nextProps),
  ]);

  for (const key of allKeys) {
    const prevValue = prevProps[key];
    const nextValue = nextProps[key];
    const hasChanged = prevValue !== nextValue;
    const isEventKey = key.startsWith("on");
    const isPropertyKey = key !== "children" && !isEventKey && key !== "ref";

    if (isEventKey) {
      // Remove old event listener if it exists and has changed or is gone
      if (prevValue && (hasChanged || !(key in nextProps))) {
        const eventType = key.toLowerCase().substring(2);
        element.removeEventListener(eventType, prevValue);
      }

      // Add new event listener if it's new or changed
      if (nextValue && hasChanged) {
        const eventType = key.toLowerCase().substring(2);
        element.addEventListener(eventType, nextValue);
      }
    } else if (isPropertyKey) {
      // Remove old property if it's gone
      if (prevValue && !(key in nextProps)) {
        (element as any)[key] = "";
      }

      // Set new or changed property
      if (nextValue && hasChanged) {
        (element as any)[key] = nextValue;
      }
    }
  }

  // Handle ref updates
  if (
    nextProps.ref &&
    typeof nextProps.ref === "object" &&
    "current" in nextProps.ref
  ) {
    nextProps.ref.current = dom;
  }
}

function commitRoot(): void {
  deletions.forEach(commitWork);
  commitWork(wipRoot!.child);
  currentRoot = wipRoot;

  // Run effects after DOM updates
  runEffects(wipRoot!);

  wipRoot = null;
}

function runEffects(fiber: Fiber | null): void {
  if (!fiber) return;

  if (fiber.effects) {
    fiber.effects.forEach((hook) => {
      if (hook.effect) {
        const cleanup = hook.effect.callback();
        if (cleanup && typeof cleanup === "function") {
          hook.effect.cleanup = cleanup;
        }
      }
    });
  }

  runEffects(fiber.child);
  runEffects(fiber.sibling);
}

function commitWork(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }

  let domParentFiber = fiber.parent!;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent!;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate!.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber: Fiber, domParent: Node): void {
  // Cleanup effects before removing from DOM
  cleanupEffects(fiber);

  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child!, domParent);
  }
}

function cleanupEffects(fiber: Fiber): void {
  if (fiber.hooks) {
    fiber.hooks.forEach((hook) => {
      if (hook.effect?.cleanup) {
        hook.effect.cleanup();
      }
    });
  }

  if (fiber.child) {
    cleanupEffects(fiber.child);
  }
  if (fiber.sibling) {
    cleanupEffects(fiber.sibling);
  }
}

export function render(element: DidactElement, container: Node): void {
  wipRoot = {
    type: "ROOT",
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
    parent: null,
    child: null,
    sibling: null,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

let nextUnitOfWork: Fiber | null = null;
let currentRoot: Fiber | null = null;
let wipRoot: Fiber | null = null;
let deletions: Fiber[] = [];

function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber: Fiber): Fiber | null {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber: Fiber | null = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
  return null;
}

let wipFiber: Fiber | null = null;
let hookIndex: number = 0;

function updateFunctionComponent(fiber: Fiber): void {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [(fiber.type as Function)(fiber.props)];
  reconcileChildren(fiber, children);
}

function updateHostComponent(fiber: Fiber): void {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props?.children || []);
}

function reconcileChildren(
  wipFiber: Fiber,
  elements: DidactElement[] = [],
): void {
  let index = 0;
  let oldFiber = wipFiber.alternate?.child;
  let prevSibling: Fiber | null = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber: Fiber | null = null;

    const sameType = oldFiber && element?.type == oldFiber.type;

    if (sameType) {
      newFiber = {
        type: oldFiber!.type,
        props: element.props,
        dom: oldFiber!.dom,
        parent: wipFiber,
        alternate: oldFiber!,
        effectTag: "UPDATE",
        child: null,
        sibling: null,
      };
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
        child: null,
        sibling: null,
      };
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling!.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

export function useState<T>(
  initial: T,
): [T, (action: T | ((state: T) => T)) => void] {
  const oldHook = wipFiber!.alternate?.hooks?.[hookIndex];
  const hook: Hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  const actions = oldHook?.queue || [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  function setState(action: T | ((state: T) => T)): void {
    const actionFn =
      typeof action === "function" ? (action as (state: T) => T) : () => action;
    hook.queue!.push(actionFn);
    wipRoot = {
      type: currentRoot!.type,
      dom: currentRoot!.dom,
      props: currentRoot!.props,
      alternate: currentRoot,
      parent: null,
      child: null,
      sibling: null,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  }

  wipFiber!.hooks!.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

export function useEffect(
  callback: () => (() => void) | void,
  deps?: any[],
): void {
  const oldHook = wipFiber!.alternate?.hooks?.[hookIndex];

  const hasChanged =
    !oldHook ||
    !oldHook.effect ||
    !deps ||
    !oldHook.effect.deps ||
    deps.length !== oldHook.effect.deps.length ||
    deps.some((dep, i) => dep !== oldHook.effect!.deps![i]);

  const hook: Hook = {
    effect: {
      callback,
      deps,
      cleanup: oldHook?.effect?.cleanup,
    },
  };

  if (hasChanged) {
    // Schedule effect to run after commit
    if (!wipFiber!.effects) {
      wipFiber!.effects = [];
    }
    wipFiber!.effects.push(hook);

    // Cleanup previous effect if it exists
    if (oldHook?.effect?.cleanup) {
      oldHook.effect.cleanup();
    }
  }

  wipFiber!.hooks!.push(hook);
  hookIndex++;
}

export function useRef<T>(initialValue: T): { current: T } {
  const oldHook = wipFiber!.alternate?.hooks?.[hookIndex];
  const hook: Hook = {
    ref: oldHook?.ref || { current: initialValue },
  };

  wipFiber!.hooks!.push(hook);
  hookIndex++;
  return hook.ref!;
}
