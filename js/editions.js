/* Edition navigation and explicit, recoverable permanent-profile transfer.
   file:// storage can differ by file; never silently replace a profile when
   following an edition link. No active run is serialized or imported here. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis, DC = root.DC = root.DC || {};
  let dialog = null, tray = null, pending = null, previousFocus = null;
  const BACKUP_KEY = 'deepcore_profile_backup_v1';
  const el = (tag, text) => {
    const n = root.document.createElement(tag);
    if (text)
      n.textContent = text;
    return n;
  };
  function download(profile, name) {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = el('a');
    a.href = url;
    a.download = name;
    root.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function message(s) {
    dialog.querySelector('[data-transfer-status]').textContent = s;
  }
  function init() {
    if (dialog || !root.document || !root.document.body)
      return;
    tray = el('nav');
    tray.className = 'edition-tray';
    tray.setAttribute('aria-label', 'Editions and progress');
    const link = el('a', 'Graphical edition');
    link.href = 'graphical.html';
    tray.appendChild(link);
    const open = el('button', 'Progress / backup');
    open.type = 'button';
    open.dataset.progress = '';
    tray.appendChild(open);
    root.document.body.appendChild(tray);
    dialog = el('dialog');
    dialog.className = 'profile-dialog';
    dialog.setAttribute('aria-labelledby', 'profile-heading');
    dialog.innerHTML = '<div class="profile-heading"><h2 id="profile-heading">Your personnel file</h2><button type="button" data-close aria-label="Close progress panel">Close</button></div><p>Foundry upgrades, cores, trophies and records. An active shift is not saved in this file.</p><p>On a web server, editions share browser storage. Offline HTML files may have separate storage: export here, then import in the other edition.</p><div class="profile-actions"><button type="button" data-export>Export current progress</button><button type="button" data-backup>Export previous backup</button></div><label class="profile-import">Import a Deepcore JSON file<input type="file" accept=".json,application/json" data-import></label><p data-transfer-status role="status">Nothing will be replaced until you review and confirm an import.</p><button type="button" data-confirm disabled>Replace local profile with reviewed file</button>';
    root.document.body.appendChild(dialog);
    root.document.addEventListener('click', e => {
      if (e.target.closest('[data-progress]'))
        show();
    });
    dialog.addEventListener('keydown', e => e.stopPropagation());
    dialog.addEventListener('close', () => {
      pending = null;
      if (previousFocus && previousFocus.isConnected)
        previousFocus.focus();
    });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-export]').addEventListener('click', () => download(DC.state.meta, 'deepcore-progress.json'));
    dialog.querySelector('[data-backup]').addEventListener('click', () => {
      try {
        const raw = root.localStorage.getItem(BACKUP_KEY);
        if (!raw) {
          message('No previous import backup is stored here.');
          return;
        }
        download(DC.Meta.parseProfile(raw), 'deepcore-previous-progress.json');
      } catch (e) {
        message('The previous backup could not be read. Export your current progress instead.');
      }
    });
    dialog.querySelector('[data-import]').addEventListener('change', async e => {
      pending = null;
      dialog.querySelector('[data-confirm]').disabled = true;
      const f = e.target.files && e.target.files[0];
      if (!f)
        return;
      if (f.size > 1024 * 1024) {
        message('That file is too large to be a Deepcore profile.');
        return;
      }
      try {
        const p = DC.Meta.parseProfile(await f.text());
        pending = p;
        message('Review import: ' + p.cores + ' cores, ' + p.runs + ' shifts, best stratum ' + p.bestDepth + '. This replaces the profile in this browser location. Your current profile will be retained as the previous-import backup.');
        dialog.querySelector('[data-confirm]').disabled = false;
      } catch (err) {
        message('Not a valid Deepcore profile. Your current progress is unchanged.');
      }
    });
    dialog.querySelector('[data-confirm]').addEventListener('click', () => {
      if (!pending || !DC.state || DC.state.screen !== 'title') {
        message('Return to the title before importing progress.');
        return;
      }
      try {
        // Do not overwrite anything if the recoverable backup cannot be stored.
        root.localStorage.setItem(BACKUP_KEY, JSON.stringify(DC.state.meta));
        root.localStorage.setItem(DC.DATA.SAVE_KEY, JSON.stringify(pending));
        DC.state.meta = DC.Meta.load();
        if (DC.Audio)
          DC.Audio.setMuted(DC.state.meta.muted);
        pending = null;
        dialog.querySelector('[data-confirm]').disabled = true;
        message('Progress imported. The previous profile is available with Export previous backup.');
      } catch (err) {
        message('Browser storage is unavailable. Import was not applied; keep your exported files.');
      }
    });
    frame(DC.state);
  }
  function show() {
    if (!dialog || !DC.state || DC.state.screen !== 'title')
      return;
    previousFocus = root.document.activeElement;
    pending = null;
    dialog.querySelector('[data-confirm]').disabled = true;
    dialog.querySelector('[data-import]').value = '';
    message('Current profile: ' + DC.state.meta.cores + ' cores, ' + DC.state.meta.runs + ' shifts. Export before moving to another offline file.');
    dialog.showModal();
  }
  function frame(st) {
    if (tray)
      tray.hidden = !st || st.screen !== 'title' || DC.Render.artMode && DC.Render.artMode() === 'bedrock';
  }
  DC.Editions = {
    init,
    frame
  };
}());
