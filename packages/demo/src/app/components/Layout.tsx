/**
 * Layout component - app shell with navigation
 */

import type { VElement } from "fibrae";
import { AtomRegistry } from "fibrae";
import * as Effect from "effect/Effect";
import { ThemeAtom, CurrentUserAtom } from "../atoms.js";

// =============================================================================
// Navigation
// =============================================================================

export function Navigation(): VElement {
  return (
    <nav data-cy="main-nav">
      <a href="/" data-cy="nav-home">Home</a>
      {" | "}
      <a href="/posts" data-cy="nav-posts">Posts</a>
      {" | "}
      <a href="/posts/new" data-cy="nav-new-post">New Post</a>
    </nav>
  );
}

// =============================================================================
// Theme Toggle
// =============================================================================

export function ThemeToggle(): Effect.Effect<VElement, never, AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const theme = registry.get(ThemeAtom);

    const toggleTheme = () => {
      registry.update(ThemeAtom, (current) => (current === "light" ? "dark" : "light"));
    };

    return (
      <button data-cy="theme-toggle" onclick={toggleTheme}>
        {theme === "light" ? "Switch to Dark" : "Switch to Light"}
      </button>
    );
  });
}

// =============================================================================
// User Display
// =============================================================================

export function UserDisplay(): Effect.Effect<VElement, never, AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const username = registry.get(CurrentUserAtom);

    const logout = () => {
      registry.set(CurrentUserAtom, null);
      // In a real app, would also call AuthClient.logout()
    };

    return (
      <div data-cy="user-display">
        {username !== null ? (
          <span>
            <span data-cy="username">{username}</span>
            {" "}
            <button data-cy="logout-btn" onclick={logout}>Logout</button>
          </span>
        ) : (
          <a href="/login" data-cy="login-link">Login</a>
        )}
      </div>
    );
  });
}

// =============================================================================
// Layout
// =============================================================================

export function Layout(props: { children: VElement }): Effect.Effect<VElement, never, AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const theme = registry.get(ThemeAtom);

    return (
      <div class={`app-layout theme-${theme}`} data-cy="app-layout">
        <header data-cy="app-header">
          <h1>Fibrae Notes</h1>
          <div class="header-actions">
            <ThemeToggle />
            <UserDisplay />
          </div>
        </header>
        <Navigation />
        <main data-cy="app-main">
          {props.children}
        </main>
      </div>
    );
  });
}
