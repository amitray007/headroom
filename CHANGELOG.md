# Changelog

## [0.1.14](https://github.com/amitray007/headroom/compare/v0.1.13...v0.1.14) (2026-10-22)


### Bug Fixes

* correct Codex reset redemption request ([#36](https://github.com/amitray007/headroom/issues/36)) ([94ffd32](https://github.com/amitray007/headroom/commit/94ffd32b045ab7c9c997c6e59962d32206c71ed7))
* refresh dashboard immediately after resetting limits ([42eea44](https://github.com/amitray007/headroom/commit/42eea441e7e7656bea6f8ace797995b659b8d686))
* refresh dashboard immediately after resetting limits ([0453ce0](https://github.com/amitray007/headroom/commit/0453ce03c01a98035755a5d63d61c2b07248fce2))

## [0.1.13](https://github.com/amitray007/headroom/compare/v0.1.12...v0.1.13) (2026-10-19)


### Features

* show when a Cursor subscription renews ([00090c1](https://github.com/amitray007/headroom/commit/00090c13d3454f1ae365c3756fadf74e250a01b1))


### Bug Fixes

* show each Cursor pool's reset and the subscription renewal date ([8bde4dd](https://github.com/amitray007/headroom/commit/8bde4dd6064084dfbd21b425fce6503f1b9f237a))
* show when each Cursor pool resets instead of "Resets with the cycle" ([433931e](https://github.com/amitray007/headroom/commit/433931e6508ff54957caced850d4c55c1686d2c7))

## [0.1.12](https://github.com/amitray007/headroom/compare/v0.1.11...v0.1.12) (2026-10-19)


### Bug Fixes

* keep the account row reset caption on one line ([13f959c](https://github.com/amitray007/headroom/commit/13f959ce12b2634324edfcc6e16ad852e2415411))
* keep the account row reset caption on one line ([db7a5cf](https://github.com/amitray007/headroom/commit/db7a5cf2efdc57951071a000c23feef46e91b161))
* read Cursor's weekly merged plans and guard against misleading figures ([0d8d962](https://github.com/amitray007/headroom/commit/0d8d9624afbd43bdc947dfccb87c424f43a01dc8))
* read Cursor's weekly merged plans and guard against misleading figures ([54d67c6](https://github.com/amitray007/headroom/commit/54d67c66c195d8b212c00396d3f1a20ce73dc2cd))

## [0.1.11](https://github.com/amitray007/headroom/compare/v0.1.10...v0.1.11) (2026-10-19)


### Features

* show a Cursor team seat's shared pool as its own meter ([4e6a47b](https://github.com/amitray007/headroom/commit/4e6a47bd636a6212408d696f77352e576b1abfe0))


### Bug Fixes

* keep RPC figures over the Cursor usage summary and align the pool headline ([84615ed](https://github.com/amitray007/headroom/commit/84615edb81fa8cca98510522d7846f454893f194))
* read Cursor enterprise and team-pool usage from usage-summary ([3eb09a4](https://github.com/amitray007/headroom/commit/3eb09a4a836af5a0330209a9e5fc98db805123cb))
* read Cursor plan usage from usage-summary for enterprise seats ([0d35a77](https://github.com/amitray007/headroom/commit/0d35a77cca79591d1ed506b3488d9760684b158b))

## [0.1.10](https://github.com/amitray007/headroom/compare/v0.1.9...v0.1.10) (2026-10-18)


### Bug Fixes

* report why a sign-in CLI stopped and find vite-plus shims ([e510d3e](https://github.com/amitray007/headroom/commit/e510d3e33dc3730fdf2aefeea4e78f77128946dc))
* report why a sign-in CLI stopped and find vite-plus shims ([962d7bb](https://github.com/amitray007/headroom/commit/962d7bb323bca53cee58615386c26f4de92a78c2))

## [0.1.9](https://github.com/amitray007/headroom/compare/v0.1.8...v0.1.9) (2026-10-17)


### Bug Fixes

* key Codex connections by member and workspace ([3add4f2](https://github.com/amitray007/headroom/commit/3add4f2518638bd5f55a5981d34a2939dfa15fb8))
* key Codex connections by member and workspace ([3c6ae9e](https://github.com/amitray007/headroom/commit/3c6ae9ef0580448357bf73ac8c3dad247f9d5a7b)), closes [#24](https://github.com/amitray007/headroom/issues/24)
* let Reconnect re-key a Codex connection the startup upgrade skipped ([78fe1e2](https://github.com/amitray007/headroom/commit/78fe1e236ace6c194b11b43a6b8f209f3b276b69))

## [0.1.8](https://github.com/amitray007/headroom/compare/v0.1.7...v0.1.8) (2026-10-16)


### Features

* warn when a weekly limit is on pace to run out early ([41b88e4](https://github.com/amitray007/headroom/commit/41b88e44edc1bd6c762933eeef0edf628e141018))
* warn when a weekly limit is on pace to run out early ([578bff2](https://github.com/amitray007/headroom/commit/578bff2f54d574c93274c856dd7585a452e7c14e))


### Bug Fixes

* **review:** retry Telegram timeouts once and keep reset times across gaps ([f189bd2](https://github.com/amitray007/headroom/commit/f189bd26659989bc69f991e8a14ce3df311c0d6c))
* say the pacing margin in days, not hours ([8401d9d](https://github.com/amitray007/headroom/commit/8401d9de62124762db63d1e316856bc9be3b5a60))
* stop repeated Telegram and webhook notifications ([70c52da](https://github.com/amitray007/headroom/commit/70c52da282ee9db2a62840d107240e94a02f8378))
* stop repeated Telegram and webhook notifications ([e882d31](https://github.com/amitray007/headroom/commit/e882d3152dc77c602fa355a1e17a8dcbb8cb68d8))

## [0.1.7](https://github.com/amitray007/headroom/compare/v0.1.6...v0.1.7) (2026-10-15)


### Bug Fixes

* address review findings on the Analytics history and phone layouts ([8dcba68](https://github.com/amitray007/headroom/commit/8dcba68a029b0265554833209ca2679a6056f7a4))
* **web:** faster Analytics and phone layouts ([624fc8e](https://github.com/amitray007/headroom/commit/624fc8e94edced1b291862ae6c1667549007c4e3))
* **web:** fit the Analytics views and Detailed emails on phones ([9491d98](https://github.com/amitray007/headroom/commit/9491d9850ed85c3ff732464e813654ee8435c6f8))


### Performance Improvements

* show Analytics history at once and read only new readings ([0bec98f](https://github.com/amitray007/headroom/commit/0bec98f862358dccfca7e3096b8f2d97b9e4cd3e))

## [0.1.6](https://github.com/amitray007/headroom/compare/v0.1.5...v0.1.6) (2026-10-14)


### Features

* Analytics view built from stored usage history ([1287fa0](https://github.com/amitray007/headroom/commit/1287fa07ac74e08c28c07f3d0c77ea12c6921d6e))
* **server:** serve usage history at /api/history ([3dfc4b7](https://github.com/amitray007/headroom/commit/3dfc4b7a80e48ca53c9c8e125e09f2ca8134a326))
* **site:** add GitHub and X cards beside the hero ([3fde495](https://github.com/amitray007/headroom/commit/3fde49524797d4e524c14a421796a9e7ae28fee3))
* **site:** count visits with self-hosted Umami ([a312d48](https://github.com/amitray007/headroom/commit/a312d48984501ff69ba325c476ce5c919174922e))
* **site:** hang the hero cards on lanyards with a live star count ([9bf0c5b](https://github.com/amitray007/headroom/commit/9bf0c5b078bd8ecc67b63f0a18784c59c63e5d14))
* **site:** link the X profile in the top nav ([1542722](https://github.com/amitray007/headroom/commit/154272217a6dacb8f5eedfcf6c6cd194d0c51cc7))
* **web:** add the Analytics view ([e864772](https://github.com/amitray007/headroom/commit/e864772bedcaa7a7baa26d9dfe76864e945de9eb))
* **web:** build Analytics from stored history ([2fcf05c](https://github.com/amitray007/headroom/commit/2fcf05c24505e9a40475725fa340a428578ee9ed))
* **web:** group the view switcher and centre it in the top bar ([3944b95](https://github.com/amitray007/headroom/commit/3944b9551541f2fed5ac34346f2070bbf30d13f1))


### Bug Fixes

* second review round on Analytics history ([04a916e](https://github.com/amitray007/headroom/commit/04a916e2a07263b095db7a7848468774be1529f5))
* **site:** let clicks on the badge buttons reach their links ([c9fc539](https://github.com/amitray007/headroom/commit/c9fc539ed901aef47a78c50ed07e03e09971e67d))
* **site:** open the GitHub and X links in a new tab ([81bca7f](https://github.com/amitray007/headroom/commit/81bca7f39dee644f4c988d383b5c2ef4b2d08e7a))
* tell a moved reset day from an early reset, and keep the cache marker fast ([b796954](https://github.com/amitray007/headroom/commit/b796954109e5ed54dbb939f33211bb4a8f5dec6c))
* **web:** correct Analytics on real history edge cases ([ff5a64d](https://github.com/amitray007/headroom/commit/ff5a64d33d7bb7f20d2a74da3e9c5075cd72b841))


### Performance Improvements

* **server:** read history in one scan, cache it and bucket by local hour ([6ca5a6b](https://github.com/amitray007/headroom/commit/6ca5a6b791a4ab3acdfc66128faacfa6f0118994))

## [0.1.5](https://github.com/amitray007/headroom/compare/v0.1.4...v0.1.5) (2026-10-10)


### Features

* **image:** install the current sign-in CLIs and smoke-test each sign-in ([7999738](https://github.com/amitray007/headroom/commit/79997388819096c26185c7648cb68972863f69a1))
* ship third-party license notices with every release ([0727232](https://github.com/amitray007/headroom/commit/0727232e3a6867fdf9af660a840998195463fb25))
* **site:** add a link preview image ([89055ee](https://github.com/amitray007/headroom/commit/89055eec3c82efd04d03fd438e099b6490ec3a81))


### Bug Fixes

* **deps:** take the latest patch and minor releases ([f6c4663](https://github.com/amitray007/headroom/commit/f6c466380e387684555d78ea546630ac0b278349))
* **release:** publish to npm and PyPI from the release workflow ([45e0372](https://github.com/amitray007/headroom/commit/45e0372d5f173291c2407a295e1f4ae8015f873f))

## [0.1.4](https://github.com/amitray007/headroom/compare/v0.1.3...v0.1.4) (2026-10-09)


### Features

* **media:** add the launch video project, its square cut, stills and README loop ([f05e3ec](https://github.com/amitray007/headroom/commit/f05e3ec0a455a15a3732adb6c922c08b3f8f492e))
* **media:** pin the square cut's captions to the bottom and add a clean square ([d86afe2](https://github.com/amitray007/headroom/commit/d86afe25ae6a2bfb0bc0206e664a0fa7ff3a74e9))


### Bug Fixes

* resolve the three CodeQL findings ([ba33148](https://github.com/amitray007/headroom/commit/ba331484f3f307b09cfac43e12ffdbf9a4fc60ad))

## [0.1.3](https://github.com/amitray007/headroom/compare/v0.1.2...v0.1.3) (2026-10-09)


### Features

* **packaging:** show the repository README and details on npm and PyPI ([45be16c](https://github.com/amitray007/headroom/commit/45be16cadd3764efb988caa9af8a090b34fb91ef))


### Bug Fixes

* **release:** trust packages.yml as the PyPI publisher ([63a4704](https://github.com/amitray007/headroom/commit/63a47045780341afe3cb789bedc02f837612e716))

## [0.1.2](https://github.com/amitray007/headroom/compare/v0.1.1...v0.1.2) (2026-10-09)


### Features

* **core:** per-user default paths, listen host and CLI binary overrides ([c906b28](https://github.com/amitray007/headroom/commit/c906b284b6ebdf47667242caad89be5c68b6e69c))
* **packaging:** publish headroomhq to npm and PyPI from the release binaries ([74ff594](https://github.com/amitray007/headroom/commit/74ff594e6e2fcf0fed3bb62ec895f2bcff92d9b8))
* report which sign-in methods the host can run ([c5020c0](https://github.com/amitray007/headroom/commit/c5020c04f8c39ca81a2c6eec237cc4d61360c575))
* **server:** add headroom update ([d7d17b0](https://github.com/amitray007/headroom/commit/d7d17b0e6e9091692d0befffb5d23cb3833399fc))
* **server:** add start flags, paths and login-service commands to the CLI ([951ae6a](https://github.com/amitray007/headroom/commit/951ae6a82ad2a4afda7024ac8ae38451b8d6618d))
* **server:** serve the web UI from inside the binary ([cd85f39](https://github.com/amitray007/headroom/commit/cd85f399b0d6d27e707181c8c6213ab7ce53af4a))
* **site:** add a one-line installer served at /install ([ca6ae98](https://github.com/amitray007/headroom/commit/ca6ae984f1cd0171654bbb6e8aaf26dd9f3e0e14))
* **site:** add an install chooser with every install channel ([f5a39b2](https://github.com/amitray007/headroom/commit/f5a39b240d57f3520ef54191ec8acdd85240fc25))
* **site:** play the launch film from the hero ([ca5d888](https://github.com/amitray007/headroom/commit/ca5d888586472f695feee7c8149784d6e322f758))


### Bug Fixes

* **site:** hide the demo's scrollbar inside the landing page ([de2ebef](https://github.com/amitray007/headroom/commit/de2ebefa2f5c63b6e659c45094c8e2b5e9ce7598))
* **site:** set the embed attribute without the dataset index signature ([f80bbbf](https://github.com/amitray007/headroom/commit/f80bbbf847422f095839a8b47e69342a1bed89b3))

## [0.1.1](https://github.com/amitray007/headroom/compare/v0.1.0...v0.1.1) (2026-10-09)


### Features

* static demo site with synthetic data and no sign-in ([45a64ec](https://github.com/amitray007/headroom/commit/45a64ec317a7745496bad2559ba1990cd6440b48))


### Bug Fixes

* **demo:** explain every refused change on the demo site ([6eebc7e](https://github.com/amitray007/headroom/commit/6eebc7e2dd97e4956ed734c872828e63a3c01edd))
* **demo:** serve the demo at /demo/ instead of /demo/index.html ([88dbde5](https://github.com/amitray007/headroom/commit/88dbde5b5bc9f9c4392ea69e044b08d40515b13a))

## 0.1.0 (2026-10-08)


### Features

* versioned releases and multi-arch Docker images on GHCR ([6d3c0f7](https://github.com/amitray007/headroom/commit/6d3c0f756f8ff6de7d197960cc22c0bdf22e710f))
