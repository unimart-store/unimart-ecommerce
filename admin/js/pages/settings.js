(() => {
  const state = { settings: null, errors: {}, saving: false, dirty: false };

  const host = () => document.getElementById("settingsFormHost");
  const saveBtn = () => document.getElementById("settingsSaveBtn");
  const statusEl = () => document.getElementById("settingsStatus");

  const setStatus = (text) => {
    if (statusEl()) statusEl().textContent = text;
  };

  const syncSaveBar = () => {
    const btn = saveBtn();
    if (btn) btn.disabled = state.saving || !state.settings;
    if (state.saving) setStatus("Saving…");
    else if (state.dirty) setStatus("You have unsaved changes.");
  };

  const render = () => {
    host().innerHTML = AdminSettingsForm.renderForm(state.settings, state.errors);
    syncSaveBar();
  };

  const renderLoading = () => {
    host().innerHTML = `<div class="admin-state"><div class="admin-spinner" role="status" aria-label="Loading"></div><p class="admin-state__desc">Loading settings…</p></div>`;
    if (saveBtn()) saveBtn().disabled = true;
  };

  const renderLoadError = (message) => {
    host().innerHTML = `
      <div class="admin-state">
        <h3 class="admin-state__title">Couldn't load settings</h3>
        <p class="admin-state__desc"></p>
        <button class="admin-btn admin-btn--primary" id="settingsRetryBtn" type="button">Try again</button>
      </div>`;
    host().querySelector(".admin-state__desc").textContent = message;
    document.getElementById("settingsRetryBtn").addEventListener("click", load);
  };

  const load = async () => {
    renderLoading();
    try {
      state.settings = await AdminSettingsService.get();
      state.errors = {};
      state.dirty = false;
      setStatus("");
      render();
    } catch (error) {
      renderLoadError(error?.message || "Something went wrong loading settings.");
    }
  };

  // ---- editing ----
  // Text/number inputs update the state silently (no re-render, so typing keeps
  // focus). Structural changes (add/remove row, type change, closed toggle) re-render.
  const onFieldChange = (event) => {
    const el = event.target;
    const path = el.dataset && el.dataset.path;
    if (!path || !state.settings) return;

    const value = AdminSettingsForm.readFieldValue(el.dataset.kind, el.value, el.checked);
    if (!AdminSettingsForm.setByPath(state.settings, path, value)) return;

    state.dirty = true;
    if (state.errors[path]) {
      delete state.errors[path];
      el.removeAttribute("aria-invalid");
      host().querySelector(`[data-error-for="${CSS.escape(path)}"]`)?.remove();
    }
    if (!state.saving) setStatus("You have unsaved changes.");

    if (el.dataset.rerender === "true" && event.type === "change") render();
  };

  const onClick = (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn || !state.settings) return;
    const index = Number(btn.dataset.index);

    const actions = {
      "add-area": () => state.settings.delivery.areas.push(AdminSettingsForm.emptyArea()),
      "remove-area": () => state.settings.delivery.areas.splice(index, 1),
      "add-courier": () => state.settings.couriers.push(AdminSettingsForm.emptyCourier()),
      "remove-courier": () => state.settings.couriers.splice(index, 1),
    };
    if (!actions[btn.dataset.action]) return;
    actions[btn.dataset.action]();
    state.errors = {}; // row indexes shifted - old error paths no longer line up
    state.dirty = true;
    render();
  };

  // ---- saving ----
  const save = async () => {
    if (state.saving || !state.settings) return; // prevents duplicate saves
    state.saving = true;
    state.errors = {};
    syncSaveBar();

    try {
      const saved = await AdminSettingsService.update(AdminSettingsForm.toPayload(state.settings));
      state.settings = saved;
      state.dirty = false;
      state.saving = false;
      setStatus("All changes saved.");
      showAdminToast("Settings saved. They are live on the website now.", "success");
      render();
    } catch (error) {
      state.saving = false;
      if (error?.status === 400 && error.body?.errors) {
        state.errors = error.body.errors;
        showAdminToast(error.message || "Please fix the highlighted fields.", "error");
        render();
        host().querySelector("[aria-invalid], .settings-error-summary")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (error?.status === 409) {
        showAdminToast(error.message, "error");
        setStatus("These settings changed elsewhere - reload the page to see the latest.");
        syncSaveBar();
      } else {
        showAdminToast(error?.message || "Could not save settings. Please try again.", "error");
        syncSaveBar();
      }
    }
  };

  (async () => {
    const user = await AdminLayout.guardAndRender("settings");
    if (!user) return;

    document.getElementById("adminContent").appendChild(document.getElementById("settingsTemplate").content.cloneNode(true));

    host().addEventListener("input", onFieldChange);
    host().addEventListener("change", onFieldChange);
    host().addEventListener("click", onClick);
    saveBtn().addEventListener("click", save);
    window.addEventListener("beforeunload", (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    await load();
  })();
})();
