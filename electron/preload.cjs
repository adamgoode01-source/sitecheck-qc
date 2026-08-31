/**
 * The only bridge between the shell and the page.
 *
 * It exposes one flag. `currentPlatform()` in `src/measurement/index.ts` reads
 * it to tell the Windows desktop build apart from a plain browser tab, which
 * changes which measurement providers are offered and what the settings screen
 * says. Nothing else crosses this boundary, because nothing else needs to.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__SITECHECK_DESKTOP__', {
  version: process.versions.electron,
});
