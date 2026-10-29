'use strict';

// Licence et version des paquets distribués (issue #335).
// IAO reste en MIT ; la version vient de package.json ; les notices de
// licence des composants tiers restent dans les binaires.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(racine, 'package-lock.json'), 'utf8'));

// Motifs --ignore="..." d'une commande electron-packager, en RegExp.
function motifsIgnores(script) {
  return [...script.matchAll(/--ignore="([^"]+)"/g)].map((m) => new RegExp(m[1]));
}

function estIgnore(motifs, chemin) {
  return motifs.some((re) => re.test(chemin));
}

test('package.json et package-lock.json déclarent la licence MIT du fichier LICENSE', () => {
  assert.equal(pkg.license, 'MIT');
  assert.equal(lock.packages[''].license, 'MIT');
  assert.match(fs.readFileSync(path.join(racine, 'LICENSE'), 'utf8'), /^MIT License/);
});

for (const nom of ['dist:win', 'dist:linux']) {
  test(nom + ' : version tirée de package.json, pas codée en dur', () => {
    assert.doesNotMatch(pkg.scripts[nom], /--app-version/);
  });

  test(nom + ' : les notices de licence restent dans le paquet', () => {
    const motifs = motifsIgnores(pkg.scripts[nom]);
    assert.ok(motifs.length > 0, 'aucun motif --ignore trouvé');
    for (const garde of [
      '/LICENSE',
      '/docs',
      '/docs/THIRD-PARTY-NOTICES.md',
      '/node_modules/monaco-editor/LICENSE',
      '/node_modules/monaco-editor/ThirdPartyNotices.txt'
    ]) {
      assert.equal(estIgnore(motifs, garde), false, garde + ' exclu du paquet');
    }
    // Le reste de la documentation et les sources de dev restent hors du paquet.
    for (const exclu of [
      '/docs/index.md',
      '/docs/assets',
      '/README.md',
      '/test',
      '/node_modules/monaco-editor/CHANGELOG.md',
      '/node_modules/monaco-editor/dev'
    ]) {
      assert.equal(estIgnore(motifs, exclu), true, exclu + ' embarqué dans le paquet');
    }
  });
}

test('electron-builder : notices gardées, documentation exclue', () => {
  const fichiers = pkg.build.files;
  const iExclusionDocs = fichiers.indexOf('!docs/**');
  const iNotices = fichiers.indexOf('docs/THIRD-PARTY-NOTICES.md');
  assert.ok(iExclusionDocs >= 0, 'la documentation doit rester exclue');
  assert.ok(iNotices > iExclusionDocs, 'THIRD-PARTY-NOTICES.md doit être réinclus après !docs/**');
  for (const motif of fichiers) {
    assert.doesNotMatch(motif, /^!.*(LICENSE|ThirdPartyNotices|THIRD-PARTY-NOTICES)/, 'notice exclue : ' + motif);
  }
});
