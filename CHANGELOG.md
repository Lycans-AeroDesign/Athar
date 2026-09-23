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
