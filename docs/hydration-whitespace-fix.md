# Hydration Whitespace Fix Research

## Problem

The `hydrateFiber` implementation in `fiber-render.ts` fails when pre-rendered HTML contains whitespace between elements.

### Error

```
TypeError: can't access property "childNodes", domNode is undefined
```

### Root Cause

The hydration code uses **index-based DOM matching**:

```typescript
const domNode = domNodes[domIndex] as HTMLElement;
```

But HTML with formatting has whitespace text nodes between elements:

```html
<div id="root">
  <div>
    <!-- newline + spaces = text node -->
    <p>0</p>
    <button>Click me</button>
  </div>
</div>
```

Actual `container.childNodes` array:

```
[#text (whitespace), DIV, #text (whitespace)]
```

When trying to match `<div>` at `domIndex=0`, we get a whitespace text node instead.

## React's Solution

React uses `getNextHydratable()` in `packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js`:

```javascript
function getNextHydratable(node: ?Node) {
  // Skip non-hydratable nodes.
  for (; node != null; node = ((node: any): Node).nextSibling) {
    const nodeType = node.nodeType;
    if (nodeType === ELEMENT_NODE || nodeType === TEXT_NODE) {
      break;
    }
    if (nodeType === COMMENT_NODE) {
      const data = (node: any).data;
      if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA ||
        // ... other special markers
      ) {
        break;
      }
      // End markers mean stop
      if (data === SUSPENSE_END_DATA) {
        return null;
      }
    }
    // Otherwise: skip this node (continue loop)
  }
  return (node: any);
}

export function getNextHydratableSibling(instance) {
  return getNextHydratable(instance.nextSibling);
}

export function getFirstHydratableChild(parentInstance) {
  return getNextHydratable(parentInstance.firstChild);
}
```

Key insight: React walks siblings with `getNextHydratable()` which:

1. Accepts ELEMENT_NODE (actual elements)
2. Accepts TEXT_NODE (including whitespace - matched against vElement text)
3. Accepts specific COMMENT_NODE markers (Suspense boundaries)
4. Skips everything else

For matching, React then uses `canHydrateInstance()` and `canHydrateTextInstance()` which **skip forward** when the current node doesn't match, looking for the next valid match.

## Fibrae's Fix

Implement cursor-based navigation with a `getNextHydratable()` helper:

```typescript
/**
 * Get the next hydratable node, skipping whitespace-only text nodes
 * and non-marker comments. Returns null if no more hydratable nodes.
 */
const getNextHydratable = (node: Node | null): Node | null => {
  while (node) {
    const nodeType = node.nodeType;

    // Element nodes are always hydratable
    if (nodeType === Node.ELEMENT_NODE) {
      return node;
    }

    // Text nodes are hydratable if they have non-whitespace content
    // (whitespace-only text nodes are skipped)
    if (nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) {
        return node;
      }
      // Skip whitespace-only text nodes
    }

    // Comment nodes are hydratable if they're Fibrae markers
    if (nodeType === Node.COMMENT_NODE) {
      const data = (node as Comment).data;
      if (data.startsWith("fibrae:")) {
        return node;
      }
      // Skip non-marker comments
    }

    node = node.nextSibling;
  }
  return null;
};

const getFirstHydratableChild = (parent: Node): Node | null => {
  return getNextHydratable(parent.firstChild);
};

const getNextHydratableSibling = (node: Node): Node | null => {
  return getNextHydratable(node.nextSibling);
};
```

Then change hydration functions to use cursor-based walking instead of index-based arrays.

## Changes Required

1. Add `getNextHydratable`, `getFirstHydratableChild`, `getNextHydratableSibling` helpers
2. Change `hydrateChildren` to use cursor + sibling walking instead of `domNodes[domIndex]`
3. Change `hydrateElement` to use `getFirstHydratableChild(domNode)` for children
4. Change `hydrateFunctionComponent` similarly
5. Return the next cursor position from hydration functions (like `hydration.ts` does)

## References

- React: `priorart/react/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js` lines 3941-3978
- Fibrae design: `docs/ssr-hydration-design.md` - mentions `getFirstHydratableChild()` and `getNextHydratableSibling()`
- Existing cursor-based implementation: `packages/fibrae/src/hydration.ts` (non-fiber renderer)
