# Asset licenses and provenance

## Feet (Daz 3D Genesis 9)

`female-feet-shins.glb` and `male-feet-shins.glb` are built from the Daz 3D characters **Laura for Genesis 9** and **Matt for Genesis 9** by `tools/assets/build_feet.py`: lower legs cut at mid-shin, subdivided once, with cropped base color, normal, and roughness maps. They are **not** CC0. They are Daz 3D content distributed under the Daz 3D license terms, and the project owner manages that licensing. The Daz source content stays in the local Daz library and never enters git. Their `*.rig.json` files are generated from the GLBs by `scripts/build-feet-assets.mjs`.

## People (Daz 3D Genesis 9)

The six people are built by `tools/assets/build_people.py` from Daz 3D Genesis 9 characters, clothing, and hair. They are **not** CC0. Like the feet, they are Daz 3D and Daz marketplace content distributed under those license terms, and the project owner manages that licensing.

| Model | Character | Clothing | Hair |
| --- | --- | --- | --- |
| `female-tan-dress` | Laura for Genesis 9 | Nelmi Marcy Dress | Eirgrid Hair (Brown) |
| `female-dark-jeans-tshirt` | Amala for Genesis 9 | Nelmi Jean Pants, BirthStone Summer Casual T-Shirt | Otart Bounce Coil Curl |
| `female-pale-shorts-croptop` | Kat for Genesis 9 | Spring Capsule Simple Crop Top, BirthStone Summer Casual (denim shorts) | OOT Spring Style Bob |
| `male-tan-shorts-tshirt` | Ty for Genesis 9 | G9 Base Shirt and Shorts | BirthStone Classic Short Hair |
| `male-dark-jeans-sleeveless` | Fabrice for Genesis 9 | dForce Classic Tank Top, CCox 50s Rebel Jeans | G9 Faded Afro Hair |
| `male-pale-trousers-shirt` | Matt for Genesis 9 | 3DStyle Minimalist Unisex sweater and pants | JL Hair 004 Multilayered Short (Golden) |

All include the Genesis 9 eyes, eyelashes, mouth, and Eyebrows Card (Style 02). The Daz libraries stay local and never enter git; `*.rig.json` files are generated from the GLBs by `scripts/build-people-assets.mjs` and `scripts/build-feet-assets.mjs`.

The earlier CC0 MakeHuman models (hm08 base mesh, MakeHuman system assets, Margaret Toigo's Dress 01) are no longer shipped.

Relevant sources:

- [MakeHuman license and asset exception](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)
- [CC0 1.0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode)
- [Public asset pack index](https://static.makehumancommunity.org/assets/assetpacks.html)

Acquired September 6, 2026. Local source files and downloaded packs are in `source-assets/makehuman/` and are excluded from Git. The packed Blender scene retains the textures used in authoring. `source-assets/provenance.json` records SHA-256 checksums of the acquired sources.

The React viewer uses React (MIT), Three.js (MIT), Vite (MIT), and Khronos glTF Validator (Apache-2.0). Their license files are included in their installed packages. The code authored for this project is licensed under MIT; see `LICENSE`.
