# Changelog

## [0.3.2](https://github.com/DanielFGray/fibrae/compare/fibrae-v0.3.1...fibrae-v0.3.2) (2026-03-19)


### Features

* add ComponentScope service for component lifecycle ([28c8beb](https://github.com/DanielFGray/fibrae/commit/28c8bebdc7599381f6b9dccd8b9090951707018d))
* add navigateTo() for SPA navigation outside Effect runtime ([306c741](https://github.com/DanielFGray/fibrae/commit/306c741ddf43cc5ddba5b2cf0a0164bbeb0e4599))
* auto-discover hydration state from DOM and upgrade to @effect-atom/atom 0.5 ([fbcbcf6](https://github.com/DanielFGray/fibrae/commit/fbcbcf6392a38db3e7f0b46af0249f7bbe568423))
* **cli:** merge CLI into fibrae as export subpaths ([c7a79b5](https://github.com/DanielFGray/fibrae/commit/c7a79b53977f9dd7e0c5aa1a52ad149d0b5e0faf))
* consolidate JSX types with VChild/VNode + prettier + fix vite config ([182e1d1](https://github.com/DanielFGray/fibrae/commit/182e1d1093f5b1f2ee015da8f543a0b100f8bc37))
* dev-mode hydration mismatch warnings for tag, text, and attributes ([b8adf35](https://github.com/DanielFGray/fibrae/commit/b8adf351ce349ada7c5714ea45c706b685911386))
* enhance router with type-safe builder API ([ad3a8ae](https://github.com/DanielFGray/fibrae/commit/ad3a8aeefe6f7aee7b6d525ba337f72a11a1b464))
* **error-boundary:** Effect-native ErrorBoundary returning Stream&lt;VElement, ComponentError&gt; ([3f9f154](https://github.com/DanielFGray/fibrae/commit/3f9f1547b4a7b7b9f3e3defec9785031b6fccb32))
* **ErrorBoundary:** JSX-style API with navigation recovery ([9c80145](https://github.com/DanielFGray/fibrae/commit/9c80145268d89f8c3741999191a12789dee2e199))
* general-purpose Head component for document head management ([a95e42f](https://github.com/DanielFGray/fibrae/commit/a95e42f5f5880a850226d37e2127f93899167bbe))
* HMR support for Vite dev mode with preserved atom state ([8441f68](https://github.com/DanielFGray/fibrae/commit/8441f68e0d4c93622b7a5c2a70e68c52891d9515))
* **jsx:** add element-specific attribute types for media, embedded, interactive, and table elements ([d6f9664](https://github.com/DanielFGray/fibrae/commit/d6f9664d4b1a65630514cb8f1b2a7343a3f1c266))
* **jsx:** add meta/script/link element types and broaden VChild ([1d7abf0](https://github.com/DanielFGray/fibrae/commit/1d7abf047b33439fdb12d0a38b36ea4f67b8cdbc))
* **jsx:** add overloads for Effect/Stream channel preservation ([e8dadee](https://github.com/DanielFGray/fibrae/commit/e8dadee4ec08bca599f8e13bf61a1e468a23fdea))
* **jsx:** add SVG element support to IntrinsicElements and runtime ([80500ed](https://github.com/DanielFGray/fibrae/commit/80500edf0bd4bf8ab398297796ae54059c873d8a))
* **live:** add live() atom constructor with Result + serialization ([3eec88a](https://github.com/DanielFGray/fibrae/commit/3eec88a3ac54c78b6682481d5f51f8ee494e581e))
* **live:** add LiveConfig service for URL resolution ([945782d](https://github.com/DanielFGray/fibrae/commit/945782d7ba50d5f72b938ebf9ca858c9a953964f))
* **live:** add sseStream — EventSource as Effect Stream ([a486fc1](https://github.com/DanielFGray/fibrae/commit/a486fc18198f79c8fa85d7c8bbc2281ac5f948a1))
* **live:** auto-activate SSE streams for live atoms in render ([91bf4e7](https://github.com/DanielFGray/fibrae/commit/91bf4e72ceec1b7d3c09b3dd894199d69c17a41d))
* **live:** deprecate channel/connect, add shared SSE connections ([79a6cd4](https://github.com/DanielFGray/fibrae/commit/79a6cd413cc89f6c7a471c19c4508aa19c1c86ec))
* **live:** serve() and serveGroup() accept live atoms alongside channels ([01487d1](https://github.com/DanielFGray/fibrae/commit/01487d1b50c9013c2277666b0b4db330b28975b7))
* **mdx:** add MDXComponents service for app-wide component injection ([e189fa2](https://github.com/DanielFGray/fibrae/commit/e189fa2bd660c0b6e767f4c7fc9c7ddb4172221b))
* **mdx:** add remark/rehype MDX-to-VElement rendering pipeline ([9b44867](https://github.com/DanielFGray/fibrae/commit/9b44867fccbde4c520c54556efd12607a88fcc04))
* **mdx:** refactor render pipeline to return Effect&lt;VElement&gt; ([7b2fc7a](https://github.com/DanielFGray/fibrae/commit/7b2fc7a02e9801a3b5bf12245d2cf1ee1c5f990b))
* re-export AtomHttpApi/AtomRpc and add component-scoped atom utils ([5cdfef9](https://github.com/DanielFGray/fibrae/commit/5cdfef9a7fb84f194d63d4617e28bd66ae01ea3b))
* **router:** add Redirect tagged error for loader/action redirects ([a635b9e](https://github.com/DanielFGray/fibrae/commit/a635b9ecf4538ae77fd5af833fbe708cf4c70c69))
* **router:** add route actions and Form component ([f6530c3](https://github.com/DanielFGray/fibrae/commit/f6530c3a4884ebce6a67e3084a17cf724414b8f9))
* **router:** type-safe navigation with route name inference ([5c39355](https://github.com/DanielFGray/fibrae/commit/5c39355c62c8b398c78b566e36eec1bb315773d5))
* Transition primitive with isPending, loader cancellation, Suspense bypass ([36af461](https://github.com/DanielFGray/fibrae/commit/36af461783b47586b1bda16394569ce9139f9b6b))
* typed Ref&lt;E&gt; with per-element inference from JSX context ([a18c78e](https://github.com/DanielFGray/fibrae/commit/a18c78ef42cff46e72e5a17d7821ffb8a21c6365))
* unified h() with Effect channel propagation via Proxy element factories ([3c91a36](https://github.com/DanielFGray/fibrae/commit/3c91a361a543785f37e6f0a478fd2d6843305790))


### Bug Fixes

* add Suspense hydration support and improve DOM property handling ([e826328](https://github.com/DanielFGray/fibrae/commit/e8263282e4c544615922bea37a833fa6d908ec0e))
* allow components to return null (render nothing) ([a0b1c18](https://github.com/DanielFGray/fibrae/commit/a0b1c181adbf014cdc2035eb22746638cb563c1a))
* batch keyed DOM reordering to fix cascading insertBefore ([455322d](https://github.com/DanielFGray/fibrae/commit/455322d97c347a2d0f43fbe229c5795202d452c4))
* boolean HTML attribute handling in JSX runtime ([820d6fa](https://github.com/DanielFGray/fibrae/commit/820d6fad869a793c176c6087361765ce34579d12))
* **cli:** prevent FOUC and fix dev SSR for SPA routes ([a1c4de9](https://github.com/DanielFGray/fibrae/commit/a1c4de94862dc506ec9c8268d9374e44e95573de))
* **dx:** invalidate linked fibrae in Vite dev server ([b4b1a4b](https://github.com/DanielFGray/fibrae/commit/b4b1a4b4b9c788f970084353f6ea54112d882bcc))
* handle defaultValue/defaultChecked as DOM properties, auto-detect services in render ([bf6d283](https://github.com/DanielFGray/fibrae/commit/bf6d28361991742087b3ef746317825b45363a77))
* handle ref changes on UPDATE and expand E2E test suite to 33 tests ([1dafb45](https://github.com/DanielFGray/fibrae/commit/1dafb4570862a4fae25b5d51e3050857ce74359c))
* **jsx:** derive global HTML attributes from native DOM types ([b86a30f](https://github.com/DanielFGray/fibrae/commit/b86a30f1120cbe7b0a84fa900e0a9cdaf0b398f4))
* **jsx:** support function refs and clean up refs on deletion ([c0cb7a9](https://github.com/DanielFGray/fibrae/commit/c0cb7a95ee78cbee03ddda8d89425b49eb334043))
* narrow hydration function error types from unknown to never ([674f2be](https://github.com/DanielFGray/fibrae/commit/674f2be7483926227ee1db6a0575f6eec00f18be))
* normalize event props to prevent onclick/onClick handler overwrite ([ab14f70](https://github.com/DanielFGray/fibrae/commit/ab14f700fef0cc1aae0a5806837aa1b51e61127f))
* **package:** add repository field for npm provenance ([30dbfbd](https://github.com/DanielFGray/fibrae/commit/30dbfbdf9cdc48e6bc776eb87e2bcbf7f987620f))
* resolve all pre-existing type errors across project ([99f46d6](https://github.com/DanielFGray/fibrae/commit/99f46d66371177e510f4b206268b4e43591261e6))
* **router:** back navigation now updates UI after SSR hydration ([0c7e121](https://github.com/DanielFGray/fibrae/commit/0c7e121e4d00627943c2905a695cc686937c0c5a))
* **router:** preserve user onClick handler on Link ([734f7b2](https://github.com/DanielFGray/fibrae/commit/734f7b24b16c759c1bc142b03a73f69f51535750))
* **router:** yield nav Effect and call startViewTransition directly ([e44ae13](https://github.com/DanielFGray/fibrae/commit/e44ae133f802580a843458cf6c77c1377b99c372))
* subscribe atoms after Suspense threshold expiry ([a19bf3e](https://github.com/DanielFGray/fibrae/commit/a19bf3ee985f6e59740c1324149a8ebcaa3458e1))
* **tests:** unwrap Effect returns in Route/Router tests, update Suspense assertion ([1045acb](https://github.com/DanielFGray/fibrae/commit/1045acbf84d8ad8347b9ee9cdcad8e0e8ad787a4))
* update repository URL to fibrae ([6a1b948](https://github.com/DanielFGray/fibrae/commit/6a1b948c105d887bdabfa84a4a5e15daf8d4ba58))

## [0.3.1](https://github.com/DanielFGray/fibrae/compare/fibrae-v0.3.0...fibrae-v0.3.1) (2026-03-18)


### Features

* **jsx:** add meta/script/link element types and broaden VChild ([1d7abf0](https://github.com/DanielFGray/fibrae/commit/1d7abf047b33439fdb12d0a38b36ea4f67b8cdbc))
* **jsx:** add SVG element support to IntrinsicElements and runtime ([80500ed](https://github.com/DanielFGray/fibrae/commit/80500edf0bd4bf8ab398297796ae54059c873d8a))
* **mdx:** add MDXComponents service for app-wide component injection ([e189fa2](https://github.com/DanielFGray/fibrae/commit/e189fa2bd660c0b6e767f4c7fc9c7ddb4172221b))
* **mdx:** add remark/rehype MDX-to-VElement rendering pipeline ([9b44867](https://github.com/DanielFGray/fibrae/commit/9b44867fccbde4c520c54556efd12607a88fcc04))
* re-export AtomHttpApi/AtomRpc and add component-scoped atom utils ([5cdfef9](https://github.com/DanielFGray/fibrae/commit/5cdfef9a7fb84f194d63d4617e28bd66ae01ea3b))
* **router:** add route actions and Form component ([f6530c3](https://github.com/DanielFGray/fibrae/commit/f6530c3a4884ebce6a67e3084a17cf724414b8f9))


### Bug Fixes

* **router:** yield nav Effect and call startViewTransition directly ([e44ae13](https://github.com/DanielFGray/fibrae/commit/e44ae133f802580a843458cf6c77c1377b99c372))
* subscribe atoms after Suspense threshold expiry ([a19bf3e](https://github.com/DanielFGray/fibrae/commit/a19bf3ee985f6e59740c1324149a8ebcaa3458e1))
* **tests:** unwrap Effect returns in Route/Router tests, update Suspense assertion ([1045acb](https://github.com/DanielFGray/fibrae/commit/1045acbf84d8ad8347b9ee9cdcad8e0e8ad787a4))

## [0.3.0](https://github.com/DanielFGray/fibrae/compare/fibrae-v0.2.3...fibrae-v0.3.0) (2026-03-15)

### Features

- add ComponentScope service for component lifecycle ([28c8beb](https://github.com/DanielFGray/fibrae/commit/28c8bebdc7599381f6b9dccd8b9090951707018d))
- add navigateTo() for SPA navigation outside Effect runtime ([306c741](https://github.com/DanielFGray/fibrae/commit/306c741ddf43cc5ddba5b2cf0a0164bbeb0e4599))
- auto-discover hydration state from DOM and upgrade to @effect-atom/atom 0.5 ([fbcbcf6](https://github.com/DanielFGray/fibrae/commit/fbcbcf6392a38db3e7f0b46af0249f7bbe568423))
- **cli:** merge CLI into fibrae as export subpaths ([c7a79b5](https://github.com/DanielFGray/fibrae/commit/c7a79b53977f9dd7e0c5aa1a52ad149d0b5e0faf))
- consolidate JSX types with VChild/VNode + prettier + fix vite config ([182e1d1](https://github.com/DanielFGray/fibrae/commit/182e1d1093f5b1f2ee015da8f543a0b100f8bc37))
- enhance router with type-safe builder API ([ad3a8ae](https://github.com/DanielFGray/fibrae/commit/ad3a8aeefe6f7aee7b6d525ba337f72a11a1b464))
- **error-boundary:** Effect-native ErrorBoundary returning Stream&lt;VElement, ComponentError&gt; ([3f9f154](https://github.com/DanielFGray/fibrae/commit/3f9f1547b4a7b7b9f3e3defec9785031b6fccb32))
- **ErrorBoundary:** JSX-style API with navigation recovery ([9c80145](https://github.com/DanielFGray/fibrae/commit/9c80145268d89f8c3741999191a12789dee2e199))
- **live:** add live() atom constructor with Result + serialization ([3eec88a](https://github.com/DanielFGray/fibrae/commit/3eec88a3ac54c78b6682481d5f51f8ee494e581e))
- **live:** add LiveConfig service for URL resolution ([945782d](https://github.com/DanielFGray/fibrae/commit/945782d7ba50d5f72b938ebf9ca858c9a953964f))
- **live:** add sseStream — EventSource as Effect Stream ([a486fc1](https://github.com/DanielFGray/fibrae/commit/a486fc18198f79c8fa85d7c8bbc2281ac5f948a1))
- **live:** auto-activate SSE streams for live atoms in render ([91bf4e7](https://github.com/DanielFGray/fibrae/commit/91bf4e72ceec1b7d3c09b3dd894199d69c17a41d))
- **live:** deprecate channel/connect, add shared SSE connections ([79a6cd4](https://github.com/DanielFGray/fibrae/commit/79a6cd413cc89f6c7a471c19c4508aa19c1c86ec))
- **live:** serve() and serveGroup() accept live atoms alongside channels ([01487d1](https://github.com/DanielFGray/fibrae/commit/01487d1b50c9013c2277666b0b4db330b28975b7))
- **router:** type-safe navigation with route name inference ([5c39355](https://github.com/DanielFGray/fibrae/commit/5c39355c62c8b398c78b566e36eec1bb315773d5))

### Bug Fixes

- add Suspense hydration support and improve DOM property handling ([e826328](https://github.com/DanielFGray/fibrae/commit/e8263282e4c544615922bea37a833fa6d908ec0e))
- boolean HTML attribute handling in JSX runtime ([820d6fa](https://github.com/DanielFGray/fibrae/commit/820d6fad869a793c176c6087361765ce34579d12))
- **cli:** prevent FOUC and fix dev SSR for SPA routes ([a1c4de9](https://github.com/DanielFGray/fibrae/commit/a1c4de94862dc506ec9c8268d9374e44e95573de))
- handle defaultValue/defaultChecked as DOM properties, auto-detect services in render ([bf6d283](https://github.com/DanielFGray/fibrae/commit/bf6d28361991742087b3ef746317825b45363a77))
- **jsx:** derive global HTML attributes from native DOM types ([b86a30f](https://github.com/DanielFGray/fibrae/commit/b86a30f1120cbe7b0a84fa900e0a9cdaf0b398f4))
- narrow hydration function error types from unknown to never ([674f2be](https://github.com/DanielFGray/fibrae/commit/674f2be7483926227ee1db6a0575f6eec00f18be))
- **package:** add repository field for npm provenance ([30dbfbd](https://github.com/DanielFGray/fibrae/commit/30dbfbdf9cdc48e6bc776eb87e2bcbf7f987620f))
- resolve all pre-existing type errors across project ([99f46d6](https://github.com/DanielFGray/fibrae/commit/99f46d66371177e510f4b206268b4e43591261e6))
- **router:** back navigation now updates UI after SSR hydration ([0c7e121](https://github.com/DanielFGray/fibrae/commit/0c7e121e4d00627943c2905a695cc686937c0c5a))
- update repository URL to fibrae ([6a1b948](https://github.com/DanielFGray/fibrae/commit/6a1b948c105d887bdabfa84a4a5e15daf8d4ba58))
