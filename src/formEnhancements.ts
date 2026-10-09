const LOADING_MS = 900;

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
  window.setTimeout(() => {
    button.dataset.loading = "false";
    button.removeAttribute("aria-busy");
  }, LOADING_MS);
}

export function installFormEnhancements(root: ParentNode = document) {
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
  return () => observer.disconnect();
}
