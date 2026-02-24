/**
 * App module exports - the Notes demo application
 *
 * This provides everything needed for both SPA and SSR entry points:
 * - Router with route definitions
 * - Handlers with loaders and components
 * - Atoms for shared state
 * - Components for UI
 */

// Router and navigation
export { AppRouter, AppRoutes, Link, RouterOutlet, type AppRouteName } from "./routes.js";

// Route handlers
export {
  createAppHandlers,
  AppHandlersServerLive,
  AppHandlersClientLive,
  AppHandlersLive,
} from "./handlers.js";

// Atoms for state management
export { ThemeAtom, CurrentUserAtom, AuthLoadingAtom, type Theme } from "./atoms.js";

// Components
export {
  Layout,
  Navigation,
  ThemeToggle,
  UserDisplay,
  PostList,
  PostListStream,
  PostDetail,
  PostForm,
  PostFormTitleAtom,
  PostFormContentAtom,
  PostFormResultAtom,
  ErrorFallback,
  NotFound,
  Loading,
} from "./components/index.js";
