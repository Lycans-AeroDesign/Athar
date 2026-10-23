## [1.19.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.18.1...v1.19.0) (2026-10-23)

### Features

* **frontend:** flip the updated badge to the labeled creation date ([f64e8f9](https://github.com/Lycans-AeroDesign/Athar/commit/f64e8f9960e6b289205d51c736e57a61537added))
* **frontend:** show a last-updated badge atop every content page ([ad11375](https://github.com/Lycans-AeroDesign/Athar/commit/ad11375f351990f0404fea95e84218f0940e0fe9))

### Bug Fixes

* **frontend:** flip the updated badge to the exact timestamp on hover ([38b27be](https://github.com/Lycans-AeroDesign/Athar/commit/38b27be03c73159f99054e004ad3a4b17dcf0fab))
* **platform:** assert free <= total - used in the disk-summary test ([c87df1c](https://github.com/Lycans-AeroDesign/Athar/commit/c87df1cafc0d40c96876cd953449c2e6984527d6))
* **platform:** relax the disk-summary invariant to match shutil's math ([787bbd3](https://github.com/Lycans-AeroDesign/Athar/commit/787bbd34e096074c768f2d7a2e3f064ddefff45e))

## [1.18.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.18.0...v1.18.1) (2026-10-23)

### Bug Fixes

* **backups:** cover Collections and the upload limit in org backups ([d380d1a](https://github.com/Lycans-AeroDesign/Athar/commit/d380d1a3eebf682cda5e5ddb6248e8d7452319d9))
* **security:** stop leaking exception text and drop CI token privileges ([6599c5b](https://github.com/Lycans-AeroDesign/Athar/commit/6599c5b32002779378d9c05fda4e4114798d07f7))

## [1.18.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.17.0...v1.18.0) (2026-10-23)

### Features

* per-org upload limits and knowledge Collections/Series ([36cde8f](https://github.com/Lycans-AeroDesign/Athar/commit/36cde8f9ccb08edd53f9863157addca0de3a88ba))
* **platform:** show system disk usage on the instance dashboard ([28c8c1d](https://github.com/Lycans-AeroDesign/Athar/commit/28c8c1dc619edfe14bad0d70a0d5fe2bc65fc775))

## [1.17.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.16.0...v1.17.0) (2026-10-22)

### Features

* **frontend:** replace plain loading messages with per-page skeleton loaders ([8191606](https://github.com/Lycans-AeroDesign/Athar/commit/8191606900941b399f5c27e74515490a50648803))

### Bug Fixes

* **engineering:** link failure component/project relations and stop photo popovers blocking table clicks ([53f88bb](https://github.com/Lycans-AeroDesign/Athar/commit/53f88bbff343c0f0d5d540d654ce7e9f47cbea48))

## [1.16.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.15.0...v1.16.0) (2026-10-18)

### Features

* add platform admin dashboard for instance operators ([0cd24ef](https://github.com/Lycans-AeroDesign/Athar/commit/0cd24ef6bb991a426b1f87c26da42468194b81f2))
* **platform:** email-only password resets and a registration toggle ([ff6bdac](https://github.com/Lycans-AeroDesign/Athar/commit/ff6bdacbb0bc63d4577efa25eb44ea3f39a8411c))

## [1.15.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.14.0...v1.15.0) (2026-10-18)

### Features

* **backend:** add token reuse detection, tenant isolation tests, upload validation, data export and deletion, and opt-in error tracking ([80592dd](https://github.com/Lycans-AeroDesign/Athar/commit/80592dd58f4d64eddb79639ac6ce2cff6121b824))
* **frontend:** add Privacy & data tab for data export and account deletion ([cb1c05f](https://github.com/Lycans-AeroDesign/Athar/commit/cb1c05fdbb2e99fc78f8fbf1eeb5e43a0e3aad1e))

### Bug Fixes

* **docker:** drop npm from the frontend runtime image ([674137c](https://github.com/Lycans-AeroDesign/Athar/commit/674137c9771cf5bb79c21833974ad650a3666e93))

## [1.14.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.13.1...v1.14.0) (2026-10-18)

### Features

* encrypt backups, tighten data privacy, and index hot queries ([3f36555](https://github.com/Lycans-AeroDesign/Athar/commit/3f3655554ef4139abfefbbf0f16a2bf88b78e330))

## [1.13.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.13.0...v1.13.1) (2026-10-14)

### Bug Fixes

* **files:** add shared PdfViewer for mobile-safe PDF rendering ([72e1d04](https://github.com/Lycans-AeroDesign/Athar/commit/72e1d0498939e20d8fb25f9d5402cc578cc5743b))

## [1.13.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.12.1...v1.13.0) (2026-10-13)

### Features

* **settings:** group settings into routed sections with a live branding preview ([42fd05d](https://github.com/Lycans-AeroDesign/Athar/commit/42fd05dae64148d731276e37b19f9ff67c066775))
* **ui:** show a create action in empty list states ([9a491d7](https://github.com/Lycans-AeroDesign/Athar/commit/9a491d71570ceafce0e5a622ff9fda2d0cbb8b7f))

### Bug Fixes

* **search:** stop the scope filter overlapping the global search text ([1e0eb3f](https://github.com/Lycans-AeroDesign/Athar/commit/1e0eb3f7b2d5288c24498f3db20cebbc2d6122bd))

## [1.12.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.12.0...v1.12.1) (2026-10-12)

### Bug Fixes

* **organization:** keep the uploaded favicon applied across navigation ([a66990c](https://github.com/Lycans-AeroDesign/Athar/commit/a66990c4621ce3fb790c813961296cde9b289b7b))

## [1.12.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.11.0...v1.12.0) (2026-10-12)

### Features

* **help:** replace About with a Help page covering each section and Markdown ([38e265b](https://github.com/Lycans-AeroDesign/Athar/commit/38e265b2148dcce7303b47ba9f2a88b699f65f66))
* **markdown:** add math, code highlighting, callouts, heading links and image zoom ([ea6603a](https://github.com/Lycans-AeroDesign/Athar/commit/ea6603af641d1e9bd16a949d62ed16ecce21aeb0))
* **organization:** use the uploaded favicon as the browser tab icon ([ef617d9](https://github.com/Lycans-AeroDesign/Athar/commit/ef617d9df43f44618fa8abc9dd9dc48ccf65cc93))
* **settings:** flag unsaved changes and warn before losing them ([667c266](https://github.com/Lycans-AeroDesign/Athar/commit/667c266385672825c7771cb564973b90d21ddaaa))

## [1.11.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.10.1...v1.11.0) (2026-10-10)

### Features

* **backups:** restore the whole organization, including from an uploaded archive ([4cc6a74](https://github.com/Lycans-AeroDesign/Athar/commit/4cc6a74d404dc4732b4ca0c33178680ec966ec1a))

## [1.10.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.10.0...v1.10.1) (2026-10-09)

### Bug Fixes

* **deps:** update dependencies to patch security advisories ([2868027](https://github.com/Lycans-AeroDesign/Athar/commit/2868027dc295a0299c761e9997d3cb5a9b302c41))

## [1.10.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.9.0...v1.10.0) (2026-10-09)

### Features

* **accounts:** email password reset links and add self-service forgot-password ([37e3bb3](https://github.com/Lycans-AeroDesign/Athar/commit/37e3bb3c69ed98eca03bb4bffabb1a12a527c02a))
* **policies:** guide members through accepting every pending policy ([71dd9c5](https://github.com/Lycans-AeroDesign/Athar/commit/71dd9c5dd2665202a7ffa8ee62cc249faa575715))
* **settings:** add user search and a per-user actions menu ([881e9ae](https://github.com/Lycans-AeroDesign/Athar/commit/881e9aee79dbefe76b3b013c8ae8b287d1885f38))

## [1.9.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.8.0...v1.9.0) (2026-10-09)

### Features

* **accounts:** add admin-generated one-time password reset links ([c34fe86](https://github.com/Lycans-AeroDesign/Athar/commit/c34fe869c637b1d4b71be7aa4bf28384e8b61c31))
* **policies:** require members to accept privacy and confidentiality policies ([baa72f8](https://github.com/Lycans-AeroDesign/Athar/commit/baa72f89bf337ee9d014918604316dff47d8fbf5))

## [1.8.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.7.0...v1.8.0) (2026-10-09)

### Features

* **knowledge:** add co-authors to articles and questions ([5ffca8d](https://github.com/Lycans-AeroDesign/Athar/commit/5ffca8d8ede788a2d2f868c8a706f7f7978098ea))
* **knowledge:** add project picker, visibility inheritance and related content to creation forms ([6261712](https://github.com/Lycans-AeroDesign/Athar/commit/626171224ae067e654372cfb7c6694ea7fd49349))
* **knowledge:** edit and remove related-content links ([2a41afc](https://github.com/Lycans-AeroDesign/Athar/commit/2a41afc96102257071413bfe12c01928d34b7912))

### Bug Fixes

* **frontend:** prevent duplicate creates on repeated save clicks ([7a12e53](https://github.com/Lycans-AeroDesign/Athar/commit/7a12e53d540b71706538cabe005619dfa3360089))
* **knowledge:** scope write-serializer foreign keys to the caller's organization ([f7a5918](https://github.com/Lycans-AeroDesign/Athar/commit/f7a59189ecd124a0db1cc20c6c2efa2f68aae644))

## [1.7.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.6.1...v1.7.0) (2026-09-25)

### Features

* **components:** add workshop inventory with two-way CSV sync, switch pks to uuid7 ([888a9c4](https://github.com/Lycans-AeroDesign/Athar/commit/888a9c4aeade68247379146c3e222c62b213e449))
* **frontend:** add icons to dropdown options across forms and filters ([4c175b8](https://github.com/Lycans-AeroDesign/Athar/commit/4c175b81fe5f786c01b4f04f81cf175e812d31aa))

## [1.6.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.6.0...v1.6.1) (2026-09-24)

### Bug Fixes

* activity feed names/links and restricted-item leak, detail meta spacing, plain-text search snippets ([b3c749f](https://github.com/Lycans-AeroDesign/Athar/commit/b3c749f2fa8d41d77ae43d6e246e129b6f8caeee))

## [1.6.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.5.0...v1.6.0) (2026-09-24)

### Features

* restricted courses, security hardening and Node 24 CI actions ([c2d5047](https://github.com/Lycans-AeroDesign/Athar/commit/c2d50479cb00309aaa02d1dea28c02401ba0e89a))

## [1.5.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.4.3...v1.5.0) (2026-09-24)

### Features

* **frontend:** align course categories with knowledge categories workflow ([9c8dc13](https://github.com/Lycans-AeroDesign/Athar/commit/9c8dc13c1f86cacf3f751ff9718500403e2ae8ef))

### Bug Fixes

* **frontend:** mobile overflow on detail pages, course categories and account menu ([31c253d](https://github.com/Lycans-AeroDesign/Athar/commit/31c253deac80a3bfd8c7f50e3860dffe5f87a523))

## [1.4.3](https://github.com/Lycans-AeroDesign/Athar/compare/v1.4.2...v1.4.3) (2026-09-23)

### Bug Fixes

* **frontend:** swap import/export CSV icons on components page ([2d0ddd1](https://github.com/Lycans-AeroDesign/Athar/commit/2d0ddd17ff248b060d0d882460fc83143122ad99))

## [1.4.2](https://github.com/Lycans-AeroDesign/Athar/compare/v1.4.1...v1.4.2) (2026-09-23)

### Bug Fixes

* **deploy:** wire ENABLE_ORGANIZATION_REGISTRATION into prod compose ([72bfae8](https://github.com/Lycans-AeroDesign/Athar/commit/72bfae89974a4baad3e08fc74b2cb35112c1881a))
* **frontend:** mobile layout fixes and editor save/discard consistency ([0a38619](https://github.com/Lycans-AeroDesign/Athar/commit/0a38619715c22c0cc7508d66f760b3f5b63a610d))

## [1.4.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.4.0...v1.4.1) (2026-09-22)

### Bug Fixes

* **organization:** rate-limit and validate org self-signup properly ([147613a](https://github.com/Lycans-AeroDesign/Athar/commit/147613a8d4e8e8739f32b00d33702b963d123f65))

## [1.4.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.3.0...v1.4.0) (2026-09-22)

### Features

* **auth,organization,layout:** togglable org signup, login/register slogan, mobile sidebar fix ([ce70ef6](https://github.com/Lycans-AeroDesign/Athar/commit/ce70ef68949ed30858da26da5e8e798ce2f6dab5))

### Bug Fixes

* **auth:** avoid setState-in-effect lint error on register page ([09a2147](https://github.com/Lycans-AeroDesign/Athar/commit/09a21473e2723f558e7d5878b04d273a9f2d5242))
* **frontend:** surface plain-string backend validation errors correctly ([a2e64ba](https://github.com/Lycans-AeroDesign/Athar/commit/a2e64bae07ec8d3bf1ab5c88f0e2ef5c3abb0fcf))

## [1.3.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.2.0...v1.3.0) (2026-09-21)

### Features

* **auth:** allow logging in with username as well as email ([805b96d](https://github.com/Lycans-AeroDesign/Athar/commit/805b96d190cdc5ece5af5500a83317fab672fa1a))
* **training:** embed video/PDF resources inline, fix editor gaps and bugs ([22ad00c](https://github.com/Lycans-AeroDesign/Athar/commit/22ad00c0628b1231ea3a0faefbd393a938638775))

### Bug Fixes

* **frontend:** stop component photo hover preview from being clipped ([898c482](https://github.com/Lycans-AeroDesign/Athar/commit/898c48229556f1f3fecd5c391bc188c04aae3526))

## [1.2.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.1.0...v1.2.0) (2026-09-20)

### Features

* add CSV bulk import and sortable table view to Components, extend table view to Failures/Tests/Documents ([a8e9d8b](https://github.com/Lycans-AeroDesign/Athar/commit/a8e9d8be8d6f8d4c59bf1ca0c1b603adb815fe4d))

### Bug Fixes

* **docker:** give celery-beat a writable schedule file path ([9f05ec8](https://github.com/Lycans-AeroDesign/Athar/commit/9f05ec8a8abfd0544045b21d9bd3a6b98e242242))
* **docker:** set prod bridge network MTU to 1460 to match GCE NICs ([4c0e2cc](https://github.com/Lycans-AeroDesign/Athar/commit/4c0e2cc1d7a5907ee8c0902d8c0ca5268eac340d))

## [1.1.0](https://github.com/Lycans-AeroDesign/Athar/compare/v1.0.2...v1.1.0) (2026-09-17)

### Features

* add drag-and-drop uploads, progress, file preview, and orphan cleanup ([f75878c](https://github.com/Lycans-AeroDesign/Athar/commit/f75878c1a5c178d20d09dc0e2fdd8e0530c70bdd))

## [1.0.2](https://github.com/Lycans-AeroDesign/Athar/compare/v1.0.1...v1.0.2) (2026-09-15)

### Bug Fixes

* **docker:** stop baking a team's domain into published frontend images ([b592b2c](https://github.com/Lycans-AeroDesign/Athar/commit/b592b2cf65c5d478c2e4881d00d6a8622898c6aa))
* fix the org-fallback test's endpoint ([c93a13d](https://github.com/Lycans-AeroDesign/Athar/commit/c93a13de6120d26c734a9febd635becf22409fc5))
* **frontend:** fix invite highlight, onboarding tour, branding tab, mobile settings, course categories ([9e67690](https://github.com/Lycans-AeroDesign/Athar/commit/9e6769025a70b6f06f1acd3435d0b2c5a1b67044))

## [1.0.1](https://github.com/Lycans-AeroDesign/Athar/compare/v1.0.0...v1.0.1) (2026-09-14)

### Bug Fixes

* resolve public-org branding bug, back up Training content, default theme light ([94aa53a](https://github.com/Lycans-AeroDesign/Athar/commit/94aa53a5b17c23b5e92354753969fd5e6327cc27))

## 1.0.0 (2026-09-14)

### Features

* add a first-run product tour, rename roles to match team structure, and rebuild migrations ([9d7bcf3](https://github.com/Lycans-AeroDesign/Athar/commit/9d7bcf34ffad6656ecaaf9489e77d1c99b151d53))
* add an nginx reverse proxy and a health check endpoint ([dae2876](https://github.com/Lycans-AeroDesign/Athar/commit/dae287661e79f6d13ac3c7e442a25a4822e3a545))
* add authentication, RBAC, org settings, and i18n foundation ([faab19f](https://github.com/Lycans-AeroDesign/Athar/commit/faab19f5c69323c1eec5d6322e12ea7c9725082d))
* add bookmarks, restricted-access grants, and user blocking ([f91e64c](https://github.com/Lycans-AeroDesign/Athar/commit/f91e64cbad5fa00486c322ffa3d878348323815b))
* add inventory quantity, photo, and link fields to components, plus CSV export ([3d0d4df](https://github.com/Lycans-AeroDesign/Athar/commit/3d0d4df8093a09e3b8a2ac62367a47fb60d7a81a))
* add invitation-code registration, article archive/unarchive, and markdown image/diagram support ([3cb879e](https://github.com/Lycans-AeroDesign/Athar/commit/3cb879e478a36ef4cbfecbb4e87e20751369d4f8))
* add Knowledge module (articles + Q&A) as a minimal, non-throwaway first slice ([3a19d3d](https://github.com/Lycans-AeroDesign/Athar/commit/3a19d3dd0129cebb9b914ccfb09da3e28110cdfc))
* add mobile-aware tour, markdown help, and contribution score periods ([1e385d0](https://github.com/Lycans-AeroDesign/Athar/commit/1e385d07d62a9d7f53f9648448b639d23234f044))
* add Projects/Components/Failures/SOPs engineering domain, @-mention picker, and nav polish ([846f899](https://github.com/Lycans-AeroDesign/Athar/commit/846f8995da3a665f97dae69fa27b90de2d939b89))
* add S3-ready storage, Postgres search ranking, and backup/restore ([194884a](https://github.com/Lycans-AeroDesign/Athar/commit/194884ae78d53458f80dd85226aabfb331ae2c64))
* add tag-based browsing, fix RTL sidebar and avatar bugs, self-host fonts ([ba7c442](https://github.com/Lycans-AeroDesign/Athar/commit/ba7c4424dd25083047a0fd798efa1323fe3060e0))
* add Test/Document knowledge types, relationship registry, and profile pages ([672b7de](https://github.com/Lycans-AeroDesign/Athar/commit/672b7de1f7ea93d3a7f21f4130673c7c7531bc90))
* add Training Center - structured courses with modules, lessons, and progress tracking ([04f9fbe](https://github.com/Lycans-AeroDesign/Athar/commit/04f9fbe7adba9a2602f4cdaa79d1b85d11e018d9))
* add user profile pictures, used system-wide ([52f0509](https://github.com/Lycans-AeroDesign/Athar/commit/52f0509f3ae62d52cf25a42f7c1d2ad880ab9521))
* expand Knowledge workflows, harden backend security, and add user profiles ([178c26c](https://github.com/Lycans-AeroDesign/Athar/commit/178c26c9ff6af7a614c7e1731ea13d055f4c989e))
* lock down container exposure, add real HTTPS via Let's Encrypt, trim README for public release ([1d00fbf](https://github.com/Lycans-AeroDesign/Athar/commit/1d00fbf8c96ae2b32d5e488b20da139bdda8891d))
* make search consistent across content types and add configurable filters ([db9a917](https://github.com/Lycans-AeroDesign/Athar/commit/db9a917ac64681281ac85494a5113c6c3c6e1b29))
* paginate Knowledge, add visibility/relations/attachments, rebuild dashboard and search ([c77a669](https://github.com/Lycans-AeroDesign/Athar/commit/c77a6697f3f4fd746c22e6a2e523443fa124672f))
* remove primary domain setting, add a demo content seed command ([1567cf8](https://github.com/Lycans-AeroDesign/Athar/commit/1567cf8ddb16255ff2616a3874dfcdb9e85f611b))
* retrofit multi-tenancy and add a contribution/recognition system ([756d637](https://github.com/Lycans-AeroDesign/Athar/commit/756d6376e278395a5d8a5dd2f796fa5a5159be89))
* wire up Roles & Permissions UI, RTL support, and per-user preferences ([fdbb90a](https://github.com/Lycans-AeroDesign/Athar/commit/fdbb90ae78a8c57f91c7c77741da850e184e2652))

### Bug Fixes

* stabilize Q&A, engineering domain, and relation visibility ([808cc4c](https://github.com/Lycans-AeroDesign/Athar/commit/808cc4ce3d91106655238d2abcd055ba022ad7a9))
