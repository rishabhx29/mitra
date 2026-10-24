# Bundled sample avatars — provenance & licensing

Mitra bundles these sample VRM avatars so the avatar persona works out of the box.
Each model also carries its own embedded license metadata, which Mitra displays
in-app when the model loads (Persona → Avatar → license fields).

| File | Source | License |
|---|---|---|
| `Seed-san.vrm` | [VRM Consortium](https://github.com/vrm-c/vrm-specification) official spec sample ("Seed-san") | VRM Consortium sample terms — evaluation/demo use; © VRM Consortium contributors |
| `Twintail_Sample.vrm` | [pixiv/three-vrm](https://github.com/pixiv/three-vrm) example model (`VRM1_Constraint_Twist_Sample`) | Distributed with the three-vrm examples; © pixiv Inc. — demo use with the library's examples |
| `AvatarSample_B.vrm`, `AvatarSample_D.vrm` | VRoid sample avatars, redistributed via [semperai/amica](https://github.com/semperai/amica) (`public/vrm/`) | VRoid sample avatar terms (permit use in apps with attribution); © pixiv Inc. |

Notes:
- amica's repo ships these same files; its MIT license covers its **code**, while
  3D models remain under "their authors respective licenses" (amica README §License) —
  hence this attribution file and the in-app license display rather than MIT claims.
- Do not use these models beyond what their terms allow; users can always load their
  own `.vrm` (drag-and-drop), and Mitra surfaces that model's embedded license too.
