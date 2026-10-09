const LOADING_MS = 900;
const loadingTimers = new Map<HTMLButtonElement, number>();
const loadingButtons = new Set<HTMLButtonElement>();

function addPasswordToggle(input: HTMLInputElement) {
  if (input.dataset.passwordToggleReady === "true") return;
  const parent = input.parentElement;
  if (!parent) return;
  input.dataset.passwordToggleReady = "true";
  parent.classList.add("password-toggle-field");
  input.classList.add("password-toggle-input");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "password-toggle-button";
  button.dataset.passwordToggle = "true";
  button.setAttribute("aria-label", "Show password");
  button.textContent = "Show";
  button.addEventListener("click", () => {
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    input.dataset.passwordVisible = String(!visible);
    button.textContent = visible ? "Show" : "Hide";
    button.setAttribute("aria-label", visible ? "Show password" : "Hide password");
    input.focus();
  });
  parent.append(button);
}

function markLoading(button: HTMLButtonElement) {
  if (button.disabled || button.dataset.loading === "true") return;
  button.dataset.loading = "true";
  button.setAttribute("aria-busy", "true");
  loadingButtons.add(button);
  loadingTimers.set(button, window.setTimeout(() => {
    button.dataset.loading = "false";
    button.removeAttribute("aria-busy");
    loadingButtons.delete(button);
    loadingTimers.delete(button);
  }, LOADING_MS));
}

function bindMutationLifecycle() {
  const start = (event: Event) => {
    const requestKey = (event as CustomEvent<{ requestKey?: string }>).detail?.requestKey;
    const active = [...loadingButtons].find((button) => button.dataset.loading === "true" && !button.dataset.loadingRequestKey);
    if (!active || !requestKey) return;
    const timer = loadingTimers.get(active);
    if (timer) window.clearTimeout(timer);
    loadingTimers.delete(active);
    active.dataset.loadingRequestKey = requestKey;
  };
  const end = (event: Event) => {
    const requestKey = (event as CustomEvent<{ requestKey?: string }>).detail?.requestKey;
    if (!requestKey) return;
    document.querySelectorAll<HTMLButtonElement>(`button[data-loading-request-key="${CSS.escape(requestKey)}"]`).forEach((button) => {
      button.dataset.loading = "false";
      button.removeAttribute("aria-busy");
      delete button.dataset.loadingRequestKey;
      loadingButtons.delete(button);
    });
  };
  window.addEventListener("dhmis:mutation-start", start);
  window.addEventListener("dhmis:mutation-end", end);
  return () => { window.removeEventListener("dhmis:mutation-start", start); window.removeEventListener("dhmis:mutation-end", end); };
}

export function installFormEnhancements(root: ParentNode = document) {
  const unbindMutationLifecycle = bindMutationLifecycle();
  const enhance = () => {
    root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(addPasswordToggle);
    root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      if (button.dataset.loadingBound === "true") return;
      if (button.dataset.passwordToggle === "true" || button.hasAttribute("aria-haspopup")) return;
      button.dataset.loadingBound = "true";
      button.addEventListener("click", () => markLoading(button), { capture: true });
    });
    root.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
      if (form.dataset.loadingBound === "true") return;
      form.dataset.loadingBound = "true";
      form.addEventListener("submit", (event) => {
        const submitter = (event as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement) markLoading(submitter);
      }, { capture: true });
    });
  };
  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["type"] });
  return () => { observer.disconnect(); unbindMutationLifecycle(); };
}
