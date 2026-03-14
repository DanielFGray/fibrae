# Changelog

## [0.3.0](https://github.com/DanielFGray/fibrae/compare/fibrae-v0.2.3...fibrae-v0.3.0) (2026-03-14)


### Features

* add ComponentScope service for component lifecycle ([28c8beb](https://github.com/DanielFGray/fibrae/commit/28c8bebdc7599381f6b9dccd8b9090951707018d))
* add navigateTo() for SPA navigation outside Effect runtime ([306c741](https://github.com/DanielFGray/fibrae/commit/306c741ddf43cc5ddba5b2cf0a0164bbeb0e4599))
* auto-discover hydration state from DOM and upgrade to @effect-atom/atom 0.5 ([fbcbcf6](https://github.com/DanielFGray/fibrae/commit/fbcbcf6392a38db3e7f0b46af0249f7bbe568423))
* **cli:** merge CLI into fibrae as export subpaths ([c7a79b5](https://github.com/DanielFGray/fibrae/commit/c7a79b53977f9dd7e0c5aa1a52ad149d0b5e0faf))
* consolidate JSX types with VChild/VNode + prettier + fix vite config ([182e1d1](https://github.com/DanielFGray/fibrae/commit/182e1d1093f5b1f2ee015da8f543a0b100f8bc37))
* enhance router with type-safe builder API ([ad3a8ae](https://github.com/DanielFGray/fibrae/commit/ad3a8aeefe6f7aee7b6d525ba337f72a11a1b464))
* **error-boundary:** Effect-native ErrorBoundary returning Stream&lt;VElement, ComponentError&gt; ([3f9f154](https://github.com/DanielFGray/fibrae/commit/3f9f1547b4a7b7b9f3e3defec9785031b6fccb32))
* **live:** add live() atom constructor with Result + serialization ([3eec88a](https://github.com/DanielFGray/fibrae/commit/3eec88a3ac54c78b6682481d5f51f8ee494e581e))
* **live:** add LiveConfig service for URL resolution ([945782d](https://github.com/DanielFGray/fibrae/commit/945782d7ba50d5f72b938ebf9ca858c9a953964f))
* **live:** add sseStream — EventSource as Effect Stream ([a486fc1](https://github.com/DanielFGray/fibrae/commit/a486fc18198f79c8fa85d7c8bbc2281ac5f948a1))
* **live:** auto-activate SSE streams for live atoms in render ([91bf4e7](https://github.com/DanielFGray/fibrae/commit/91bf4e72ceec1b7d3c09b3dd894199d69c17a41d))
* **live:** deprecate channel/connect, add shared SSE connections ([79a6cd4](https://github.com/DanielFGray/fibrae/commit/79a6cd413cc89f6c7a471c19c4508aa19c1c86ec))
* **live:** serve() and serveGroup() accept live atoms alongside channels ([01487d1](https://github.com/DanielFGray/fibrae/commit/01487d1b50c9013c2277666b0b4db330b28975b7))


### Bug Fixes

* add Suspense hydration support and improve DOM property handling ([e826328](https://github.com/DanielFGray/fibrae/commit/e8263282e4c544615922bea37a833fa6d908ec0e))
* boolean HTML attribute handling in JSX runtime ([820d6fa](https://github.com/DanielFGray/fibrae/commit/820d6fad869a793c176c6087361765ce34579d12))
* handle defaultValue/defaultChecked as DOM properties, auto-detect services in render ([bf6d283](https://github.com/DanielFGray/fibrae/commit/bf6d28361991742087b3ef746317825b45363a77))
* **package:** add repository field for npm provenance ([30dbfbd](https://github.com/DanielFGray/fibrae/commit/30dbfbdf9cdc48e6bc776eb87e2bcbf7f987620f))
* **router:** back navigation now updates UI after SSR hydration ([0c7e121](https://github.com/DanielFGray/fibrae/commit/0c7e121e4d00627943c2905a695cc686937c0c5a))
* update repository URL to fibrae ([6a1b948](https://github.com/DanielFGray/fibrae/commit/6a1b948c105d887bdabfa84a4a5e15daf8d4ba58))
