# Composants tiers

IAO est distribué sous licence [MIT](https://github.com/Mathilde-Team/IAO/blob/dev/LICENSE).
Il embarque les composants suivants, tous en local (aucun CDN).

| Composant | Fichiers | Licence | Source |
|---|---|---|---|
| Polices Inter, Space Grotesk, JetBrains Mono | `assets/fonts/*.woff2` | SIL Open Font License 1.1 | [Google Fonts](https://fonts.google.com/) |
| Icônes Font Awesome Free 6.5.1 (tracés SVG) | `assets/icons.js` | CC BY 4.0 | [fontawesome.com](https://fontawesome.com/license/free) |
| Logos des services d'IA (Lobe Icons, `@lobehub/icons-static-svg` 1.101.0) | `lib/service-icons.js` | MIT, © LobeHub | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) |
| Logo Wolfram (Simple Icons 16.36.0) | `lib/service-icons.js` | CC0 1.0 | [simpleicons.org](https://simpleicons.org/) |
| Monaco Editor | `node_modules/monaco-editor` | MIT, © Microsoft | [microsoft/monaco-editor](https://github.com/microsoft/monaco-editor) |
| Electron | exécutable | MIT, © contributeurs Electron | [electron/electron](https://github.com/electron/electron) |

## Dans les paquets distribués

Les paquets (`npm run dist:win`, `dist:linux`, AppImage, deb) embarquent
(issue #335) :

- `LICENSE` d'IAO et ce fichier (`docs/THIRD-PARTY-NOTICES.md`), dans `resources/app.asar` ;
- `LICENSE` (ou `LICENSE.electron.txt`) d'Electron et `LICENSES.chromium.html`, à côté de l'exécutable ;
- `LICENSE` et `ThirdPartyNotices.txt` de Monaco, dans `resources/app.asar.unpacked/node_modules/monaco-editor/`.

La version des paquets est celle de `package.json`.

## Logos des services

Les logos de `lib/service-icons.js` (issue #324) restent des marques de leurs
propriétaires respectifs (Anthropic, OpenAI, Google, Zhipu AI, Perplexity, xAI,
Suno, Meshy, Mistral AI, DeepSeek, GitHub/Microsoft, Wolfram, DeepL, Ideogram,
Kuaishou, Runway, Pika, Alibaba). Ils sont affichés uniquement pour désigner le
service correspondant, sans suggérer de partenariat. Leonardo AI et Elicit n'ont
pas de logo disponible sous licence libre : IAO affiche l'initiale du nom.
