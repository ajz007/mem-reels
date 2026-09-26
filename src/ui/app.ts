import {
  createCheckoutSession,
  createDraft,
  deleteJob,
  enableLocalLiveSubmission,
  fetchGenerationProposal,
  fetchAccount,
  fetchJob,
  fetchReels,
  fetchSession,
  fetchStorageHealth,
  fetchTemplateDetail,
  fetchTemplates,
  recordInteractionAnalytics,
  resetLocalDemo,
  submitFixture,
  submitLiveGeneration,
  uploadSource,
  verifyCheckoutPayment,
} from "../api/product";
import type {
  AccountSummary,
  CheckoutSession,
  GenerationProposal,
  Job,
  TemplateDetail,
  TemplateSummary,
  UserIdentity,
} from "../domain/types";
import type { ValidationRuleResult } from "../domain/validation";
import {
  toTemplateSummary,
  weddingPortraitTemplate as fixtureTemplate,
} from "../fixtures/template";

type Screen =
  | "catalogue"
  | "library"
  | "template"
  | "upload"
  | "validated"
  | "proposal"
  | "rejected"
  | "progress"
  | "delivery";

interface ScreenMeta {
  eyebrow: string;
  title: string;
  step: number;
  back?: Screen;
}

const screens: Record<Screen, ScreenMeta> = {
  catalogue: { eyebrow: "Your first reel", title: "Bring a treasured photo to life", step: 1 },
  library: { eyebrow: "Your account", title: "My Reels", step: 5, back: "catalogue" },
  template: {
    eyebrow: "Template details",
    title: "Choose with confidence",
    step: 1,
    back: "catalogue",
  },
  upload: {
    eyebrow: "Wedding portrait comes alive",
    title: "Choose one clear photo",
    step: 2,
    back: "catalogue",
  },
  validated: {
    eyebrow: "Photo check complete",
    title: "Your photo is ready",
    step: 3,
    back: "upload",
  },
  proposal: {
    eyebrow: "Final review",
    title: "Know exactly what happens next",
    step: 4,
    back: "validated",
  },
  rejected: {
    eyebrow: "Photo check",
    title: "Let’s try a different photo",
    step: 3,
    back: "upload",
  },
  progress: { eyebrow: "Creating your reel", title: "A little magic is in progress", step: 4 },
  delivery: { eyebrow: "Your private reel", title: "Your memory is ready", step: 5 },
};

const stepLabels = ["Moment", "Photo", "Check", "Create", "Enjoy"] as const;

export async function renderApp(root: HTMLDivElement): Promise<void> {
  let current: Screen = readScreen();
  let user: UserIdentity | null = null;
  let templates: readonly TemplateSummary[] = [toTemplateSummary(fixtureTemplate)];
  let template: TemplateDetail | null = null;
  let validatedJobId: string | null = window.sessionStorage.getItem(
    "memory-reels-validated-job-id",
  );
  let selectedFile: File | null = null;
  let selectedFileUrl: string | null = null;
  let submissionError: string | null = null;
  let proposal: GenerationProposal | null = null;
  let storageHealth: { configured: boolean; accessible: boolean } | null = null;
  let activeJob: Job | null = null;
  let account: AccountSummary | null = null;
  let libraryJobs: Job[] = [];
  let checkoutFeedback: string | null = null;
  let pollingJobId: string | null = null;
  let catalogueViewRecorded = false;
  const analyticsSessionReference = getAnalyticsSessionReference();

  root.innerHTML = loadingContent();

  try {
    const [session, catalogue] = await Promise.all([fetchSession(), fetchTemplates()]);
    user = session;
    templates = catalogue;
    if (user) {
      [account, libraryJobs] = await Promise.all([fetchAccount(), fetchReels()]);
    }

    if (validatedJobId) {
      try {
        activeJob = await fetchJob(validatedJobId);
        if (["deleted", "deletion_requested"].includes(activeJob.status)) {
          activeJob = null;
          validatedJobId = null;
          window.sessionStorage.removeItem("memory-reels-validated-job-id");
        }
      } catch {
        validatedJobId = null;
        window.sessionStorage.removeItem("memory-reels-validated-job-id");
      }
    }

    const requestedTemplateId =
      activeJob?.templateId ?? readTemplateId() ?? templates[0]?.id ?? fixtureTemplate.id;
    try {
      template = await fetchTemplateDetail(requestedTemplateId);
    } catch {
      template = null;
    }

    if (current === "proposal" && validatedJobId) {
      try {
        [proposal, storageHealth] = await Promise.all([
          fetchGenerationProposal(validatedJobId),
          fetchStorageHealth(),
        ]);
      } catch {
        current = "validated";
      }
    }
  } catch {
    root.innerHTML = unavailableContent();
    document.querySelector<HTMLButtonElement>("#retry-app")?.addEventListener("click", () => {
      window.location.reload();
    });
    return;
  }

  const requestedScreen = current;
  current = reconcileScreen(current, validatedJobId, proposal, activeJob, template);
  if (current !== requestedScreen) window.history.replaceState({}, "", `#${current}`);

  const go = (next: Screen, options: { keepError?: boolean; replace?: boolean } = {}): void => {
    if (next === "upload" && current === "rejected") clearSelectedFile();
    current = reconcileScreen(next, validatedJobId, proposal, activeJob, template);
    if (!options.keepError) submissionError = null;
    const method = options.replace ? "replaceState" : "pushState";
    const hash =
      current === "template" && template
        ? `#template?id=${encodeURIComponent(template.id)}`
        : `#${current}`;
    window.history[method]({}, "", hash);
    draw();
    moveFocusToScreen();
  };

  const syncRoute = async (): Promise<void> => {
    current = readScreen();
    if (current === "template") {
      const templateId = readTemplateId();
      if (templateId && template?.id !== templateId) {
        try {
          template = await fetchTemplateDetail(templateId);
        } catch {
          template = null;
        }
      }
    }
    current = reconcileScreen(current, validatedJobId, proposal, activeJob, template);
    submissionError = null;
    draw();
    moveFocusToScreen();
  };

  window.addEventListener("popstate", () => void syncRoute());
  window.addEventListener("hashchange", () => void syncRoute());

  function draw(): void {
    current = reconcileScreen(current, validatedJobId, proposal, activeJob, template);
    const meta = screenMeta(current, activeJob, template);
    const content = screenContent(
      current,
      templates,
      template,
      user,
      validatedJobId,
      proposal,
      storageHealth,
      activeJob,
      account,
      libraryJobs,
    );

    root.innerHTML = `
      <main class="page-shell">
        <header class="topbar">
          <a class="brand" href="#catalogue" data-go="catalogue" aria-label="Memory Reels home">memory<span>reels</span></a>
          <a class="user-chip" href="#library" data-go="library" title="${user ? `Signed in as ${escapeHtml(user.displayName)}` : "Sign-in required"}">
            <span class="user-dot" aria-hidden="true"></span>
            ${user ? `${account?.balance ?? 0} credits · My Reels` : "Sign in"}
          </a>
        </header>
        ${stepperContent(meta.step)}
        <section class="panel" aria-labelledby="screen-title">
          ${meta.back ? `<button class="back-link" data-go="${meta.back}" aria-label="Go back"><span aria-hidden="true">←</span> Back</button>` : ""}
          <header class="screen-heading">
            <p class="eyebrow">${escapeHtml(meta.eyebrow)}</p>
            <h1 id="screen-title" tabindex="-1">${escapeHtml(meta.title)}</h1>
          </header>
          ${submissionError ? `<div class="error-notice" role="alert"><strong>We couldn’t complete that step.</strong><span>${escapeHtml(submissionError)}</span></div>` : ""}
          ${checkoutFeedback ? `<p class="action-feedback neutral" role="status">${escapeHtml(checkoutFeedback)}</p>` : ""}
          ${content}
        </section>
        <p class="prototype-notice">Private by default · Nothing is generated or charged until you explicitly approve it.</p>
      </main>
    `;

    if (current === "catalogue" && !catalogueViewRecorded) {
      catalogueViewRecorded = true;
      trackInteraction("template_catalogue_viewed", "succeeded", "catalogue_opened");
    }

    document.querySelectorAll<HTMLElement>("[data-template-id]").forEach((control) => {
      control.addEventListener("click", async (event) => {
        event.preventDefault();
        const templateId = control.dataset.templateId;
        if (!templateId) return;
        try {
          template = await fetchTemplateDetail(templateId);
          trackInteraction(
            "template_selected",
            "succeeded",
            "template_chosen",
            undefined,
            template,
          );
        } catch {
          template = null;
        }
        current = "template";
        window.history.pushState({}, "", `#template?id=${encodeURIComponent(templateId)}`);
        draw();
        moveFocusToScreen();
      });
    });

    document.querySelectorAll<HTMLElement>("[data-go]").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.preventDefault();
        const next = control.dataset.go as Screen;
        go(next);
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-pack-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const packId = button.dataset.packId;
        if (!packId) return;
        button.disabled = true;
        submissionError = null;
        try {
          const checkout = await createCheckoutSession(packId);
          const outcome = await openRazorpayCheckout(checkout);
          account = await fetchAccount();
          checkoutFeedback =
            account.purchases.find((purchase) => purchase.id === checkout.purchaseId)?.status ===
            "paid"
              ? "Payment confirmed. Your purchased credits are available."
              : outcome === "cancelled"
                ? "Checkout closed. No credits were added. If you completed payment, check purchase history for confirmation."
                : "Payment signature verified. Credits will appear after captured-payment confirmation. If they are pending, refresh purchase history before retrying.";
          draw();
        } catch (caught) {
          submissionError = caught instanceof Error ? caught.message : "Could not start checkout.";
          draw();
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-library-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const jobId = button.dataset.libraryDelete;
        if (!jobId) return;
        button.disabled = true;
        try {
          await deleteJob(jobId);
          libraryJobs = await fetchReels();
          draw();
        } catch (caught) {
          submissionError =
            caught instanceof Error ? caught.message : "Could not delete this reel.";
          draw();
        }
      });
    });
    document.querySelectorAll<HTMLAnchorElement>("[data-library-open]").forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const jobId = link.dataset.libraryOpen;
        if (!jobId) return;
        activeJob = await fetchJob(jobId);
        validatedJobId = jobId;
        window.sessionStorage.setItem("memory-reels-validated-job-id", jobId);
        go("delivery");
      });
    });

    attachUploadHandlers();
    attachFlowHandlers();
  }

  function attachUploadHandlers(): void {
    const fileInput = document.querySelector<HTMLInputElement>("#source-file");
    const consent = document.querySelector<HTMLInputElement>("#permission-confirmed");
    const validateButton = document.querySelector<HTMLButtonElement>("#validate-source");
    const error = document.querySelector<HTMLParagraphElement>("#upload-error");
    const preview = document.querySelector<HTMLImageElement>("#photo-preview");
    const emptyState = document.querySelector<HTMLElement>("#upload-empty-state");
    const selectedState = document.querySelector<HTMLElement>("#upload-selected-state");

    if (!fileInput || !consent || !validateButton || !error || !preview) return;

    const showUploadError = (message: string): void => {
      error.textContent = message;
      error.hidden = false;
    };

    const updateReadiness = (): void => {
      const isReady = Boolean(selectedFile && consent.checked);
      validateButton.disabled = !isReady;
      validateButton.setAttribute("aria-disabled", String(!isReady));
      const readiness = document.querySelector<HTMLElement>("#upload-readiness");
      if (readiness) {
        readiness.textContent = !selectedFile
          ? "Choose a photo to continue."
          : !consent.checked
            ? "Confirm permission to continue."
            : "Ready for a private quality check.";
        readiness.classList.toggle("is-ready", isReady);
      }
    };

    if (selectedFile && selectedFileUrl) {
      preview.src = selectedFileUrl;
      preview.hidden = false;
      if (emptyState) emptyState.hidden = true;
      if (selectedState) {
        selectedState.hidden = false;
        selectedState.querySelector<HTMLElement>("strong")!.textContent = selectedFile.name;
        selectedState.querySelector<HTMLElement>("span")!.textContent = formatFileSize(
          selectedFile.size,
        );
      }
    }

    fileInput.addEventListener("change", () => {
      error.hidden = true;
      const file = fileInput.files?.[0] ?? null;
      if (!file) {
        clearSelectedFile();
        updateReadiness();
        return;
      }
      if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
        clearSelectedFile();
        fileInput.value = "";
        showUploadError("Choose a JPEG, PNG, or WebP image.");
        updateReadiness();
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        clearSelectedFile();
        fileInput.value = "";
        showUploadError("Choose an image smaller than 20 MB.");
        updateReadiness();
        return;
      }

      clearSelectedFile();
      selectedFile = file;
      selectedFileUrl = URL.createObjectURL(file);
      preview.src = selectedFileUrl;
      preview.hidden = false;
      if (emptyState) emptyState.hidden = true;
      if (selectedState) {
        selectedState.hidden = false;
        selectedState.querySelector<HTMLElement>("strong")!.textContent = file.name;
        selectedState.querySelector<HTMLElement>("span")!.textContent = formatFileSize(file.size);
      }
      updateReadiness();
    });

    consent.addEventListener("change", () => {
      error.hidden = true;
      updateReadiness();
    });

    validateButton.addEventListener("click", async () => {
      if (!selectedFile || !consent.checked || !template) {
        showUploadError("Choose a photo and confirm permission before continuing.");
        return;
      }
      error.hidden = true;
      setButtonBusy(validateButton, true, "Checking photo…");
      try {
        const draft = await createDraft(template.id, consent.checked);
        const job = await uploadSource(draft.id, selectedFile);
        activeJob = job;
        validatedJobId = job.id;
        window.sessionStorage.setItem("memory-reels-validated-job-id", job.id);
        if (job.status === "validated") {
          go("validated");
        } else {
          submissionError = job.error?.message ?? "This photo could not be validated.";
          go("rejected", { keepError: true });
        }
      } catch (caught) {
        showUploadError(
          caught instanceof Error ? caught.message : "We couldn’t check this photo. Try again.",
        );
        setButtonBusy(validateButton, false);
      }
    });

    updateReadiness();
  }

  function attachFlowHandlers(): void {
    document
      .querySelector<HTMLButtonElement>("#review-live")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) return go("upload");
        const button = document.querySelector<HTMLButtonElement>("#review-live");
        submissionError = null;
        if (button) setButtonBusy(button, true, "Preparing review…");
        try {
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          go("proposal");
        } catch (caught) {
          submissionError =
            caught instanceof Error ? caught.message : "Could not prepare the request.";
          draw();
        }
      });

    document
      .querySelector<HTMLButtonElement>("#submit-live")
      ?.addEventListener("click", async () => {
        if (!validatedJobId || !proposal) return;
        const button = document.querySelector<HTMLButtonElement>("#submit-live");
        submissionError = null;
        if (button) setButtonBusy(button, true, "Starting your reel…");
        try {
          activeJob = await submitLiveGeneration(validatedJobId, proposal);
          // Reservation (or an immediate compensating release) is server-owned.
          // Refresh the display without treating a balance lookup as a submission failure.
          await refreshAccountState();
          if (activeJob.status === "failed") {
            submissionError = activeJob.error?.message ?? "The request was not accepted.";
            draw();
            return;
          }
          go("progress");
          void pollUntilTerminal(validatedJobId);
        } catch (caught) {
          submissionError =
            caught instanceof Error ? caught.message : "Could not create this reel.";
          draw();
        }
      });

    document
      .querySelector<HTMLInputElement>("#approve-live-cost")
      ?.addEventListener("change", (event) => {
        const button = document.querySelector<HTMLButtonElement>("#submit-live");
        const checkbox = event.currentTarget as HTMLInputElement;
        if (button) {
          button.disabled = !checkbox.checked;
          button.setAttribute("aria-disabled", String(!checkbox.checked));
        }
      });

    document
      .querySelector<HTMLButtonElement>("#enable-live-test")
      ?.addEventListener("click", async (event) => {
        if (!validatedJobId) return;
        const button = event.currentTarget as HTMLButtonElement;
        submissionError = null;
        setButtonBusy(button, true, "Enabling test mode…");
        try {
          await enableLocalLiveSubmission();
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          draw();
        } catch (caught) {
          submissionError = caught instanceof Error ? caught.message : "Could not enable testing.";
          draw();
        }
      });

    document
      .querySelector<HTMLButtonElement>("#retry-configuration")
      ?.addEventListener("click", async (event) => {
        if (!validatedJobId) return;
        const button = event.currentTarget as HTMLButtonElement;
        submissionError = null;
        setButtonBusy(button, true, "Checking storage…");
        try {
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          draw();
        } catch (caught) {
          submissionError = caught instanceof Error ? caught.message : "Could not recheck setup.";
          draw();
        }
      });

    document
      .querySelector<HTMLButtonElement>("#submit-fixture")
      ?.addEventListener("click", async (event) => {
        if (!validatedJobId) return go("upload");
        const button = event.currentTarget as HTMLButtonElement;
        submissionError = null;
        setButtonBusy(button, true, "Starting free demo…");
        try {
          activeJob = await submitFixture(validatedJobId);
          go("progress");
          void pollUntilTerminal(validatedJobId);
        } catch (caught) {
          submissionError =
            caught instanceof Error ? caught.message : "Could not create this reel.";
          draw();
        }
      });

    document
      .querySelector<HTMLButtonElement>("#reset-local-demo")
      ?.addEventListener("click", async (event) => {
        if (!window.confirm("Reset this demo and remove its locally stored photo and reel?"))
          return;
        const button = event.currentTarget as HTMLButtonElement;
        setButtonBusy(button, true, "Resetting…");
        try {
          await resetLocalDemo();
          clearJobState();
          go("catalogue");
        } catch (caught) {
          submissionError = caught instanceof Error ? caught.message : "Could not reset the demo.";
          draw();
        }
      });

    document
      .querySelector<HTMLButtonElement>("#delete-fixture")
      ?.addEventListener("click", async (event) => {
        if (!validatedJobId) return;
        if (!window.confirm("Delete this photo and reel? This cannot be undone.")) return;
        const button = event.currentTarget as HTMLButtonElement;
        setButtonBusy(button, true, "Deleting…");
        try {
          await deleteJob(validatedJobId);
          clearJobState();
          go("catalogue");
        } catch (caught) {
          setActionFeedback(
            caught instanceof Error ? caught.message : "Could not delete this reel.",
            "error",
          );
          setButtonBusy(button, false);
        }
      });

    const shareButton = document.querySelector<HTMLButtonElement>("#share-reel");
    if (shareButton) {
      if (!navigator.share || activeJob?.attempt?.provider === "local-fixture") {
        shareButton.hidden = true;
      } else {
        shareButton.addEventListener("click", async () => {
          if (!validatedJobId) return;
          setButtonBusy(shareButton, true, "Preparing share…");
          try {
            const response = await fetch(`/api/jobs/${validatedJobId}/delivery`, {
              credentials: "same-origin",
            });
            if (!response.ok) throw new Error("The reel could not be prepared for sharing.");
            const blob = await response.blob();
            const file = new File([blob], "memory-reel.mp4", { type: "video/mp4" });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({
                title: "My Memory Reel",
                text: "A treasured photo, brought gently to life.",
                files: [file],
              });
            } else {
              await navigator.share({
                title: "My Memory Reel",
                text: "My Memory Reel is ready. Download it to share the private video file.",
              });
            }
            setActionFeedback(
              "Share sheet opened. You stay in control of where it goes.",
              "success",
            );
            trackInteraction("reel_shared", "succeeded", "share_completed", validatedJobId);
          } catch (caught) {
            if (caught instanceof DOMException && caught.name === "AbortError") {
              setActionFeedback("Sharing cancelled. Your reel is still private.", "neutral");
              trackInteraction("reel_shared", "cancelled", "share_cancelled", validatedJobId);
            } else {
              setActionFeedback(
                caught instanceof Error ? caught.message : "This reel could not be shared.",
                "error",
              );
              trackInteraction("reel_shared", "failed", "share_failed", validatedJobId);
            }
          } finally {
            setButtonBusy(shareButton, false);
          }
        });
      }
    }
  }

  function trackInteraction(
    name: "template_catalogue_viewed" | "template_selected" | "reel_shared",
    resultStatus: "succeeded" | "failed" | "cancelled",
    reasonCode:
      | "catalogue_opened"
      | "template_chosen"
      | "share_completed"
      | "share_cancelled"
      | "share_failed",
    jobId?: string,
    templateOverride?: Pick<TemplateSummary, "id" | "version">,
  ): void {
    const eventTemplate = templateOverride ?? template ?? templates[0];
    if (!eventTemplate) return;
    void recordInteractionAnalytics({
      name,
      templateId: eventTemplate.id,
      templateVersion: eventTemplate.version,
      anonymousSessionReference: analyticsSessionReference,
      ...(jobId ? { jobId } : {}),
      resultStatus,
      reasonCode,
    }).catch(() => undefined);
  }

  async function pollUntilTerminal(jobId: string): Promise<void> {
    if (pollingJobId === jobId) return;
    pollingJobId = jobId;
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      try {
        activeJob = await fetchJob(jobId);
        if (activeJob.status === "completed") {
          await refreshAccountState();
          pollingJobId = null;
          return go("delivery");
        }
        if (activeJob.status === "failed") {
          await refreshAccountState();
          pollingJobId = null;
          submissionError = activeJob.error?.message ?? "Video generation did not complete.";
          return draw();
        }
        draw();
      } catch {
        pollingJobId = null;
        submissionError =
          "We lost the live status update. Reload to reconnect without starting again.";
        return draw();
      }
    }
  }

  async function refreshAccountState(): Promise<void> {
    if (!user) return;
    try {
      const [freshAccount, freshJobs] = await Promise.all([fetchAccount(), fetchReels()]);
      account = freshAccount;
      libraryJobs = freshJobs;
    } catch {
      // A transient account read must never resubmit an accepted generation.
      // Keep the last known state; the next lifecycle refresh can reconnect.
    }
  }

  function moveFocusToScreen(): void {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector<HTMLElement>("#screen-title")?.focus({ preventScroll: true });
    });
  }

  function clearSelectedFile(): void {
    if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
    selectedFile = null;
    selectedFileUrl = null;
  }

  function clearJobState(): void {
    window.sessionStorage.removeItem("memory-reels-validated-job-id");
    validatedJobId = null;
    proposal = null;
    activeJob = null;
    submissionError = null;
    clearSelectedFile();
  }

  draw();
  if (current === "progress" && validatedJobId) void pollUntilTerminal(validatedJobId);
}

function getAnalyticsSessionReference(): string {
  const storageKey = "memory-reels-analytics-session";
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const reference = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, reference);
  return reference;
}

function readScreen(): Screen {
  const candidate = window.location.hash.slice(1).split("?")[0];
  return isScreen(candidate) ? candidate : "catalogue";
}

function readTemplateId(): string | null {
  const query = window.location.hash.split("?")[1];
  return query ? new URLSearchParams(query).get("id") : null;
}

function isScreen(value: string): value is Screen {
  return Object.prototype.hasOwnProperty.call(screens, value);
}

function reconcileScreen(
  requested: Screen,
  jobId: string | null,
  proposal: GenerationProposal | null,
  job: Job | null,
  template: TemplateDetail | null,
): Screen {
  if (
    requested === "catalogue" ||
    requested === "library" ||
    requested === "template" ||
    requested === "rejected"
  )
    return requested;
  if (requested === "upload" && !template) return "catalogue";
  if (requested === "upload") return requested;
  if (!jobId) return requested === "validated" || requested === "proposal" ? "upload" : "catalogue";
  if (job?.status === "rejected") return "rejected";
  if (requested === "proposal" && !proposal) return "validated";
  if (requested === "delivery" && job && job.status !== "completed") return "progress";
  if (requested === "progress" && job?.status === "completed") return "delivery";
  return requested;
}

function screenMeta(screen: Screen, job: Job | null, template: TemplateDetail | null): ScreenMeta {
  if (screen === "delivery" && job?.attempt?.provider === "local-fixture") {
    return { ...screens.delivery, eyebrow: "Free demo complete", title: "The demo path works" };
  }
  if (screen === "template" && template)
    return { ...screens.template, eyebrow: template.category, title: template.title };
  if (screen === "upload" && template)
    return { ...screens.upload, eyebrow: template.title, back: "template" };
  if (screen === "validated" && job?.validationResult?.outcome === "ready")
    return { ...screens.validated, title: "Your photo is a strong match" };
  if (screen === "validated" && job?.validationResult?.outcome === "ready_with_warnings")
    return { ...screens.validated, title: "Your photo can work—with a few risks" };
  if (screen === "rejected" && job?.validationResult)
    return { ...screens.rejected, title: "This photo needs a different approach" };
  return screens[screen];
}

function screenContent(
  screen: Screen,
  templates: readonly TemplateSummary[],
  template: TemplateDetail | null,
  user: UserIdentity | null,
  jobId: string | null,
  proposal: GenerationProposal | null,
  storageHealth: { configured: boolean; accessible: boolean } | null,
  activeJob: Job | null,
  account: AccountSummary | null,
  libraryJobs: readonly Job[],
): string {
  switch (screen) {
    case "catalogue":
      return catalogueContent(templates, user);
    case "library":
      return libraryContent(account, libraryJobs, templates, user);
    case "template":
      return templateDetailContent(template, user);
    case "upload":
      return template ? uploadContent(template) : unavailableTemplateContent();
    case "validated":
      return template
        ? validationResultContent(template, activeJob, templates)
        : unavailableTemplateContent();
    case "proposal":
      return proposalContent(proposal, storageHealth);
    case "rejected":
      return rejectedContent(activeJob, templates);
    case "progress":
      return progressContent(activeJob);
    case "delivery":
      return deliveryContent(jobId, activeJob);
  }
}

function stepperContent(currentStep: number): string {
  return `
    <nav class="stepper" aria-label="Create reel progress">
      <ol>
        ${stepLabels
          .map((label, index) => {
            const step = index + 1;
            const state =
              step < currentStep ? "is-complete" : step === currentStep ? "is-current" : "";
            return `<li class="${state}" ${step === currentStep ? 'aria-current="step"' : ""}><span class="step-marker" aria-hidden="true">${step < currentStep ? "✓" : step}</span><span class="step-label">${label}</span></li>`;
          })
          .join("")}
      </ol>
    </nav>
  `;
}

export function catalogueContent(
  templates: readonly TemplateSummary[],
  user: UserIdentity | null,
): string {
  if (templates.length === 0)
    return `<div class="empty-state"><h2>No templates are available right now</h2><p>Nothing is wrong with your account. Please check back after the next approved collection is published.</p></div>`;
  const collections = groupTemplatesByCollection(templates);
  return `
    <p class="lede">Choose an approved motion style, review its requirements, then upload privately.</p>
    <div class="catalogue-collections">
      ${[...collections.entries()]
        .map(
          ([collection, items]) => `
            <section class="template-collection" aria-labelledby="collection-${slugify(collection)}">
              <header class="collection-heading"><p class="eyebrow">Collection</p><h2 id="collection-${slugify(collection)}">${escapeHtml(collection)}</h2></header>
              <div class="template-grid">${items.map((item) => templateCardContent(item, user)).join("")}</div>
            </section>`,
        )
        .join("")}
    </div>
    <div class="trust-row" aria-label="Privacy and control">
      <span><b aria-hidden="true">✓</b> No free-form prompts</span>
      <span><b aria-hidden="true">✓</b> You approve before generation</span>
    </div>
  `;
}

function libraryContent(
  account: AccountSummary | null,
  jobs: readonly Job[],
  templates: readonly TemplateSummary[],
  user: UserIdentity | null,
): string {
  if (!user)
    return `<div class="empty-state"><h2>Sign in to see your reels</h2><p>Your balance, receipts, and private deliveries are available only to you.</p><a class="button button-primary" href="/api/auth/google/start">Sign in</a></div>`;
  const reelCards = jobs.length
    ? jobs
        .map((job) => {
          const template = templates.find((candidate) => candidate.id === job.templateId);
          const deleted = job.status === "deleted" || job.status === "deletion_requested";
          const ready = job.status === "completed" && !deleted;
          return `<article class="library-reel">
            <img src="${escapeHtml(template?.poster.url ?? fixtureTemplate.poster.url)}" alt="" />
            <div class="library-reel-copy">
              <div><h3>${escapeHtml(template?.title ?? "Memory reel")}</h3><span class="status-pill status-${escapeHtml(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span></div>
              <p>Created ${escapeHtml(formatDate(job.consent.acknowledgedAt))}${job.expiresAt ? ` · Expires ${escapeHtml(formatExpiry(job.expiresAt))}` : ""}</p>
              <div class="library-actions">
                ${ready ? `<a href="/api/jobs/${job.id}/delivery?download=1" download>Download</a><a href="#delivery" data-library-open="${job.id}">Open & share</a>` : ""}
                ${!deleted ? `<button type="button" data-library-delete="${job.id}">Delete</button>` : "<span>Private media deleted</span>"}
              </div>
            </div>
          </article>`;
        })
        .join("")
    : `<div class="empty-state compact"><h2>No reels yet</h2><p>Your validated, generating, delivered, and deleted reels will appear here.</p><button class="button button-primary" data-go="catalogue">Create your first reel</button></div>`;
  const purchases = account?.purchases.length
    ? account.purchases
        .map(
          (purchase) =>
            `<li><span><strong>${purchase.credits} credits</strong><small>${escapeHtml(formatDate(purchase.createdAt))} · ${escapeHtml(purchase.receiptReference)}</small></span><span><strong>${formatInr(purchase.amountPaise)}</strong><small>${escapeHtml(purchaseStatusLabel(purchase.status))}</small></span></li>`,
        )
        .join("")
    : `<li class="empty-purchase">No purchases yet. Development grants are not payment receipts.</li>`;
  return `<div class="account-balance"><span>Available balance</span><strong>${account?.balance ?? 0}</strong><small>reel credits</small></div>
    <section class="library-section"><div class="section-title"><h2>Your private reels</h2><button class="text-button" data-go="catalogue">Create another</button></div><div class="library-list">${reelCards}</div></section>
    <section class="library-section"><div class="section-title"><h2>Add credits</h2><span>One-time purchase</span></div><div class="credit-packs">${(
      account?.packs ?? []
    )
      .map(
        (pack) =>
          `<article><span>${escapeHtml(pack.name)}</span><strong>${pack.credits} credits</strong><p>${escapeHtml(pack.description)}</p><button class="button button-secondary button-block" data-pack-id="${pack.id}">Buy for ${formatInr(pack.amountPaise)}</button></article>`,
      )
      .join(
        "",
      )}</div><p class="quiet-copy centered">Secure checkout is provided by Razorpay. Credits are added only after verified payment confirmation.</p></section>
    <section class="library-section"><div class="section-title"><h2>Purchase history</h2><span>Receipts</span></div><ul class="purchase-list">${purchases}</ul></section>`;
}

function jobStatusLabel(status: Job["status"]): string {
  if (status === "completed") return "Ready";
  if (status === "failed" || status === "rejected") return "Needs attention";
  if (status === "deleted" || status === "deletion_requested") return "Deleted";
  if (["queued", "submitting", "generating", "storing"].includes(status)) return "Creating";
  return "Draft";
}

function purchaseStatusLabel(
  status: NonNullable<AccountSummary>["purchases"][number]["status"],
): string {
  if (status === "paid") return "Paid · credits added";
  if (status === "payment_pending") return "Awaiting confirmation";
  if (status === "refunded") return "Refunded";
  if (status === "failed") return "Payment failed";
  return "Checkout prepared";
}

function formatInr(amountPaise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amountPaise / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

async function openRazorpayCheckout(checkout: CheckoutSession): Promise<"verified" | "cancelled"> {
  await loadRazorpayScript();
  const Razorpay = (
    window as Window & {
      Razorpay?: new (options: Record<string, unknown>) => {
        open(): void;
        on(event: string, callback: () => void): void;
      };
    }
  ).Razorpay;
  if (!Razorpay) throw new Error("Secure checkout could not be loaded.");
  return new Promise((resolve, reject) => {
    let verifying = false;
    let paymentFailed = false;
    const modal = new Razorpay({
      key: checkout.publicKeyId,
      order_id: checkout.providerOrderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Memory Reels",
      description: `${checkout.credits} reel credits`,
      modal: {
        ondismiss: () => {
          if (!verifying) {
            if (paymentFailed)
              reject(
                new Error("Payment attempt failed. Check purchase history before trying again."),
              );
            else resolve("cancelled");
          }
        },
      },
      handler: (payment: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        verifying = true;
        void verifyCheckoutPayment(checkout.purchaseId, payment)
          .then(() => resolve("verified"))
          .catch(reject);
      },
      theme: { color: "#a73761" },
    });
    // Razorpay displays the attempt failure in its modal and permits retry there.
    // Keep the purchase button locked until the modal closes or a retry succeeds.
    modal.on("payment.failed", () => {
      paymentFailed = true;
    });
    modal.open();
  });
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if ((window as Window & { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      razorpayScriptPromise = null;
      reject(new Error("Secure checkout could not be loaded. Please try again."));
    };
    document.head.append(script);
  });
  return razorpayScriptPromise;
}

function templateCardContent(template: TemplateSummary, user: UserIdentity | null): string {
  return `
    <article class="template-card">
      <div class="preview-media">
        <img src="${escapeHtml(template.poster.url)}" alt="${escapeHtml(template.poster.alt)}" width="720" height="1280" />
        <span class="media-badge">${escapeHtml(template.category)}</span>
        <span class="format-badge">${template.output.durationSeconds} sec · ${template.output.aspectRatio}</span>
      </div>
      <div class="template-copy">
        <p class="card-kicker">${escapeHtml(template.costDescription)}</p>
        <h3>${escapeHtml(template.title)}</h3>
        <p class="card-description">${escapeHtml(template.description)}</p>
        <ul class="template-facts" aria-label="Template details">
          ${template.tags
            .slice(0, 3)
            .map((tag) => `<li>${escapeHtml(tag)}</li>`)
            .join("")}
        </ul>
        ${
          user
            ? `<button class="button button-primary button-block" data-template-id="${escapeHtml(template.id)}"><span>View template</span><span aria-hidden="true">→</span></button>`
            : '<a class="button button-primary button-block" href="/api/auth/google/start"><span>Sign in to view</span><span aria-hidden="true">→</span></a>'
        }
      </div>
    </article>`;
}

export function templateDetailContent(
  template: TemplateDetail | null,
  user: UserIdentity | null,
): string {
  if (!template) return unavailableTemplateContent();
  const paidApproved = template.generationAvailability === "paid_approved";
  return `
    <div class="template-detail-layout">
      <section class="sample-stage" aria-label="Sample reel preview">
        ${
          template.sampleVideo.url
            ? `<video controls playsinline preload="metadata" poster="${escapeHtml(template.sampleVideo.posterUrl)}" aria-label="${escapeHtml(template.sampleVideo.alt)}"><source src="${escapeHtml(template.sampleVideo.url)}" type="video/mp4" /></video>`
            : `<div class="sample-pending"><img src="${escapeHtml(template.sampleVideo.posterUrl)}" alt="${escapeHtml(template.sampleVideo.alt)}" /><span class="sample-play" aria-hidden="true">▶</span><p><strong>Sample preview pending</strong><span>${escapeHtml(template.sampleVideo.label)}</span></p></div>`
        }
        <p class="sample-disclosure">${template.sampleVideo.availability === "available" ? "Template sample" : "Poster preview only · not an AI-generated result"}</p>
      </section>
      <div class="template-detail-copy">
        <p class="lede">${escapeHtml(template.description)}</p>
        ${!paidApproved ? '<div class="status-card warning compact"><span class="status-icon" aria-hidden="true">!</span><div><h2>Development fixture only</h2><p>Paid generation is unavailable until this template and its private recipe are approved.</p></div></div>' : ""}
        <section class="detail-section source-example"><div><p class="eyebrow">Example source</p><h2>${escapeHtml(template.inputGuidance.title)}</h2><p>${escapeHtml(template.inputGuidance.description)}</p></div><img src="${escapeHtml(template.exampleSource.url)}" alt="${escapeHtml(template.exampleSource.alt)}" /></section>
        <section class="detail-section"><p class="eyebrow">What you need</p><ul class="requirement-list">${template.inputGuidance.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
        <div class="guidance-stack detail-guidance">
          <section class="guidance good"><p class="guidance-label"><span aria-hidden="true">✓</span> Works best</p><ul>${template.eligibilityConditions.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></section>
          <section class="guidance avoid"><p class="guidance-label"><span aria-hidden="true">×</span> Avoid</p><ul>${template.unsupportedConditions.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></section>
        </div>
        <dl class="summary detail-summary">
          <div><dt>Input</dt><dd>${template.requiredInputCount} photo</dd></div>
          <div><dt>Output</dt><dd>${template.output.durationSeconds}s · ${template.output.aspectRatio} · ${escapeHtml(template.output.resolution.label)}</dd></div>
          <div><dt>Price</dt><dd>${escapeHtml(template.costDescription)}</dd></div>
          <div><dt>Privacy</dt><dd>${escapeHtml(template.privacyDescription)}</dd></div>
        </dl>
        ${
          user
            ? `<button class="button button-primary button-block" data-go="upload"><span>${paidApproved ? "Upload my photo" : "Try fixture upload"}</span><span aria-hidden="true">→</span></button>`
            : '<a class="button button-primary button-block" href="/api/auth/google/start"><span>Sign in to continue</span><span aria-hidden="true">→</span></a>'
        }
      </div>
    </div>`;
}

function unavailableTemplateContent(): string {
  return `<div class="empty-state"><p class="eyebrow">Template unavailable</p><h2>This template can’t be opened</h2><p>It may still be in review, retired, or the link may be incomplete. No upload or generation has started.</p><button class="button button-primary" data-go="catalogue">Browse available templates</button></div>`;
}

function uploadContent(template: TemplateDetail): string {
  return `
    <p class="lede">We’ll privately check quality and fit before anything is sent for generation.</p>
    <div class="upload-layout">
      <div class="upload-action">
        <label class="upload-dropzone" for="source-file">
          <input class="visually-hidden-input" id="source-file" type="file" accept="image/jpeg,image/png,image/webp" />
          <img id="photo-preview" alt="Your selected portrait preview" hidden />
          <span id="upload-empty-state" class="upload-empty">
            <span class="upload-icon" aria-hidden="true">＋</span>
            <strong>Choose a portrait</strong>
            <span>JPEG, PNG or WebP · up to 20 MB</span>
          </span>
          <span id="upload-selected-state" class="upload-selected" hidden>
            <strong></strong><span></span><em>Tap to change</em>
          </span>
        </label>
        <label class="consent-card">
          <input id="permission-confirmed" type="checkbox" />
          <span><strong>I have permission to use this photo</strong><small>Everyone shown has agreed to this reel being created.</small></span>
        </label>
        <p id="upload-error" class="inline-error" role="alert" hidden></p>
        <p id="upload-readiness" class="readiness" aria-live="polite">Choose a photo to continue.</p>
        <button id="validate-source" class="button button-primary button-block" disabled aria-disabled="true">Check my photo</button>
      </div>
      <div class="guidance-stack">
        <section class="guidance good">
          <p class="guidance-label"><span aria-hidden="true">✓</span> Works best</p>
          <ul>${template.eligibilityConditions.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
        </section>
        <section class="guidance avoid">
          <p class="guidance-label"><span aria-hidden="true">×</span> Try another photo if</p>
          <ul>${template.unsupportedConditions.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
        </section>
        <button class="text-button" data-go="rejected">See an example photo error</button>
      </div>
    </div>
  `;
}

function validationResultContent(
  template: TemplateDetail,
  job: Job | null,
  templates: readonly TemplateSummary[],
): string {
  const result = job?.validationResult;
  if (!result) {
    return `<div class="empty-state"><h2>Run the current photo check</h2><p>This job was created before the current compatibility policy. Upload the photo again so generation uses the same approved rules.</p><button class="button button-primary" data-go="upload">Check photo again</button></div>`;
  }
  const warnings = result.rules.filter((rule) => rule.status === "warning");
  const passes = result.rules.filter((rule) => rule.status === "pass");
  const isReady = result.outcome === "ready";
  return `
    <div class="status-card ${isReady ? "success" : "warning"}">
      <span class="status-icon" aria-hidden="true">${isReady ? "✓" : "!"}</span>
      <div><h2>${isReady ? "Ready for this template" : "Usable, with specific risks"}</h2><p>${isReady ? "The photo passed every available technical and template-fit check." : "The photo can continue, but review the risks before deciding."}</p></div>
    </div>
    ${validationRulesSection("What passed", passes, "pass")}
    ${warnings.length ? validationRulesSection("Risks to consider", warnings, "warning") : ""}
    <div class="validation-provider-note"><strong>Advanced check</strong><span>${validationProviderCopy(result)}</span></div>
    ${alternativeTemplatesContent(result.compatibleAlternativeTemplateIds, templates)}
    <dl class="summary">
      <div><dt>Template</dt><dd>${escapeHtml(template.title)}</dd></div>
      <div><dt>You’ll receive</dt><dd>One ${template.output.durationSeconds}-second vertical reel</dd></div>
      <div><dt>Price</dt><dd>${escapeHtml(template.costDescription)}</dd></div>
      <div><dt>Rules used</dt><dd>${escapeHtml(result.policyId)} · v${result.policyVersion}</dd></div>
    </dl>
    <div class="action-stack">
      ${template.generationAvailability === "paid_approved" ? `<button id="review-live" class="button button-primary button-block"><span>${isReady ? "Review cost and create" : "Continue with these risks"}</span><span aria-hidden="true">→</span></button>` : ""}
      <button id="submit-fixture" class="button button-secondary button-block">Run free demo instead</button>
      <button class="button button-quiet button-block" data-go="upload">Choose a different photo</button>
      <button id="reset-local-demo" class="text-button danger-text">Reset local demo</button>
    </div>
    <p class="no-credit-confirmation"><span aria-hidden="true">✓</span><strong>No credit was used.</strong> No generation request has been submitted.</p>
  `;
}

function proposalContent(
  proposal: GenerationProposal | null,
  storage: { configured: boolean; accessible: boolean } | null,
): string {
  if (!proposal) {
    return `<div class="empty-state"><h2>Your review needs refreshing</h2><p>Return to your accepted photo and prepare the request again.</p><button class="button button-secondary" data-go="validated">Back to photo check</button></div>`;
  }
  const ready =
    proposal.providerConfigured && proposal.liveSubmissionEnabled && storage?.accessible === true;
  return `
    <p class="lede">One reel, one approval, and no surprise charge.</p>
    <div class="cost-card">
      <span>Maximum for this test</span>
      <strong>US$${proposal.estimatedMaximumCostUsd.toFixed(2)}</strong>
      <small>1 beta credit · charged only after you confirm below</small>
    </div>
    <dl class="summary request-summary">
      <div><dt>Photo</dt><dd>Your privately stored portrait</dd></div>
      <div><dt>Motion</dt><dd>Warm expression, subtle fabric movement, gentle push-in</dd></div>
      <div><dt>Output</dt><dd>One 5-second vertical MP4</dd></div>
      <div><dt>Privacy</dt><dd>Owner-only access, expires after 24 hours</dd></div>
    </dl>
    <div class="status-card ${ready ? "success" : "warning"}">
      <span class="status-icon" aria-hidden="true">${ready ? "✓" : "!"}</span>
      <div><h2>${ready ? "Ready when you are" : "Testing setup needs attention"}</h2><p>${escapeHtml(configurationMessage(proposal, storage))}</p></div>
    </div>
    ${
      ready
        ? '<label class="consent-card approval-consent"><input id="approve-live-cost" type="checkbox" /><span><strong>I approve this one live test</strong><small>It will cost no more than US$0.35.</small></span></label>'
        : ""
    }
    <div class="action-stack">
      ${!proposal.liveSubmissionEnabled ? '<button id="enable-live-test" class="button button-primary button-block">Enable live test mode</button>' : ""}
      ${proposal.liveSubmissionEnabled && storage?.accessible !== true ? '<button id="retry-configuration" class="button button-primary button-block">Recheck private storage</button>' : ""}
      ${ready ? '<button id="submit-live" class="button button-primary button-block" disabled aria-disabled="true"><span>Create my reel</span><span aria-hidden="true">→</span></button>' : ""}
      <button class="button button-quiet button-block" data-go="validated">Back without submitting</button>
    </div>
    <p class="quiet-copy centered">Nothing is submitted until you check the approval box and press “Create my reel.”</p>
  `;
}

function configurationMessage(
  proposal: GenerationProposal,
  storage: { configured: boolean; accessible: boolean } | null,
): string {
  if (!proposal.providerConfigured)
    return "The video service key is missing. Add it to apps/web/.env and restart the app.";
  if (!proposal.liveSubmissionEnabled)
    return "The paid test switch is locked. Enabling test mode below does not submit or charge anything.";
  if (!storage?.configured)
    return "Private S3 storage is not configured. Add the region and bucket, then restart.";
  if (!storage.accessible)
    return "The app cannot access the private S3 bucket. Check its credentials and permissions, then retry.";
  return "Private storage and the video service are ready. Nothing has been submitted yet.";
}

function rejectedContent(job: Job | null, templates: readonly TemplateSummary[]): string {
  const result = job?.validationResult;
  if (result) {
    const failures = result.rules.filter((rule) => rule.status === "failure");
    const passes = result.rules.filter((rule) => rule.status === "pass");
    const warnings = result.rules.filter((rule) => rule.status === "warning");
    return `
      <div class="status-card warning"><span class="status-icon" aria-hidden="true">!</span><div><h2>Not suitable for this template</h2><p>The photo was stopped before generation because one or more required checks failed.</p></div></div>
      ${passes.length ? validationRulesSection("What passed", passes, "pass") : ""}
      ${validationRulesSection("What needs fixing", [...failures, ...warnings], "failure")}
      ${alternativeTemplatesContent(result.compatibleAlternativeTemplateIds, templates)}
      <div class="action-stack"><button class="button button-primary button-block" data-go="upload"><span>Choose another photo</span><span aria-hidden="true">→</span></button><button class="button button-quiet button-block" data-go="catalogue">Browse templates</button></div>
      <p class="no-credit-confirmation"><span aria-hidden="true">✓</span><strong>No credit was used.</strong> The photo was not sent for generation.</p>`;
  }
  const message =
    job?.error?.message ??
    "This example represents a corrupt or incomplete image. It would never be sent to a video provider.";
  return `
    <div class="status-card warning">
      <span class="status-icon" aria-hidden="true">!</span>
      <div><h2>This photo wasn’t uploaded</h2><p>${escapeHtml(message)}</p></div>
    </div>
    <div class="recovery-card">
      <h2>What to try</h2>
      <ul><li>Export or download a fresh copy of the image.</li><li>Use a JPEG, PNG, or WebP under 20 MB.</li><li>Choose an image at least 320 pixels on each side.</li></ul>
    </div>
    <button class="button button-primary button-block" data-go="upload"><span>Choose another photo</span><span aria-hidden="true">→</span></button>
    <p class="quiet-copy centered">No credit was reserved and no generation was queued.</p>
  `;
}

function validationRulesSection(
  title: string,
  rules: readonly ValidationRuleResult[],
  tone: "pass" | "warning" | "failure",
): string {
  if (rules.length === 0) return "";
  return `<section class="validation-group ${tone}"><h2>${escapeHtml(title)}</h2><ul>${rules
    .map(
      (rule) =>
        `<li class="${rule.status}"><span class="rule-marker" aria-hidden="true">${rule.status === "pass" ? "✓" : rule.status === "warning" ? "!" : "×"}</span><div><strong>${escapeHtml(rule.explanation)}</strong>${rule.status === "pass" ? "" : `<span>${escapeHtml(rule.suggestedCorrection)}</span>`}</div></li>`,
    )
    .join("")}</ul></section>`;
}

function validationProviderCopy(result: NonNullable<Job["validationResult"]>): string {
  if (result.visionAssessment.imageSentToExternalProvider)
    return "The image was sent to the disclosed AI validation provider. Its observations were checked against deterministic template rules.";
  if (result.visionAssessment.status === "completed")
    return "A local deterministic fixture supplied structured observations; no external AI provider received the image.";
  if (result.visionAssessment.status === "malformed")
    return "The advanced result was incomplete and was ignored for the final decision. No external provider is enabled in this build.";
  return "Advanced subject analysis was unavailable. Only deterministic file checks influenced this result; no external provider received the image.";
}

function alternativeTemplatesContent(
  templateIds: readonly string[],
  templates: readonly TemplateSummary[],
): string {
  const alternatives = templateIds
    .map((templateId) => templates.find((template) => template.id === templateId))
    .filter((template): template is TemplateSummary => Boolean(template));
  return `<section class="alternative-templates"><h2>Compatible alternatives</h2>${
    alternatives.length
      ? `<div>${alternatives.map((template) => `<button class="alternative-template" data-template-id="${escapeHtml(template.id)}"><img src="${escapeHtml(template.poster.url)}" alt="" /><span><strong>${escapeHtml(template.title)}</strong><small>${escapeHtml(template.category)}</small></span><b aria-hidden="true">→</b></button>`).join("")}</div>`
      : "<p>No verified alternative is currently available. A clearer or wider source photo is the safest next step.</p>"
  }</section>`;
}

function progressContent(job: Job | null): string {
  const status = job?.status ?? "queued";
  const activeIndex = progressIndex(status);
  const statusCopy = progressStatusCopy(status);
  const stages = [
    ["Request received", "Your approved request is safely queued."],
    ["Creating gentle motion", "The video service is animating your portrait."],
    ["Securing your reel", "The MP4 is moving into private storage."],
  ] as const;
  return `
    <div class="creation-status" role="status" aria-live="polite">
      <div class="reel-loader" aria-hidden="true"><span></span><span></span><span></span></div>
      <strong>${escapeHtml(statusCopy.title)}</strong>
      <span>${escapeHtml(statusCopy.detail)}</span>
    </div>
    <ol class="timeline" aria-label="Reel creation status">
      ${stages
        .map(
          ([title, detail], index) =>
            `<li class="${index < activeIndex ? "is-complete" : index === activeIndex ? "is-current" : ""}" ${index === activeIndex ? 'aria-current="step"' : ""}><span class="timeline-marker" aria-hidden="true">${index < activeIndex ? "✓" : index + 1}</span><div><b>${title}</b><span>${detail}</span></div></li>`,
        )
        .join("")}
    </ol>
    <div class="safe-to-leave"><strong>You can safely leave this page.</strong><span>Come back on this device and we’ll reconnect to the same request—no duplicate charge.</span></div>
  `;
}

function deliveryContent(jobId: string | null, job: Job | null): string {
  if (!jobId) {
    return `<div class="empty-state"><h2>No delivery found</h2><p>Start with a portrait to create your first reel.</p><button class="button button-primary" data-go="catalogue">Create a reel</button></div>`;
  }
  const isFixture = job?.attempt?.provider === "local-fixture";
  const expiry = job?.expiresAt ? formatExpiry(job.expiresAt) : "within 24 hours";

  if (isFixture) {
    return `
      <div class="fixture-delivery">
        <span class="fixture-icon" aria-hidden="true">✓</span>
        <h2>Your end-to-end demo succeeded</h2>
        <p>No AI video was generated and no credit was used. Upload, validation, persisted progress, private delivery, and deletion are all connected.</p>
      </div>
      <div id="action-feedback" class="action-feedback" role="status" aria-live="polite" hidden></div>
      <div class="action-stack">
        <a class="button button-secondary button-block" href="/api/jobs/${jobId}/delivery?download=1" download>Download demo receipt</a>
        <button class="button button-quiet button-block" data-go="catalogue">Create another memory</button>
        <button id="delete-fixture" class="text-button danger-text">Delete photo and demo</button>
      </div>
      <p class="quiet-copy centered">This private demo expires ${escapeHtml(expiry)}.</p>
    `;
  }

  return `
    <div class="video-shell"><video class="delivery-video" controls playsinline preload="metadata" src="/api/jobs/${jobId}/delivery"></video><span>AI-generated video</span></div>
    <div class="status-card success compact">
      <span class="status-icon" aria-hidden="true">✓</span>
      <div><h2>Private delivery ready</h2><p>Review faces, hands, motion, and overall feel before you share.</p></div>
    </div>
    <div id="action-feedback" class="action-feedback" role="status" aria-live="polite" hidden></div>
    <div class="action-stack delivery-actions">
      <a class="button button-primary button-block" href="/api/jobs/${jobId}/delivery?download=1" download>Save reel</a>
      <button id="share-reel" class="button button-secondary button-block">Share reel</button>
      <button id="delete-fixture" class="text-button danger-text">Delete photo and reel</button>
    </div>
    <p class="quiet-copy centered">Only you can access this delivery. It expires ${escapeHtml(expiry)}.</p>
  `;
}

function progressIndex(status: Job["status"]): number {
  if (status === "storing") return 2;
  if (status === "generating") return 1;
  return 0;
}

function progressStatusCopy(status: Job["status"]): { title: string; detail: string } {
  if (status === "storing")
    return { title: "Almost there", detail: "Securing your finished reel in private storage." };
  if (status === "generating")
    return {
      title: "Your portrait is coming to life",
      detail: "This is usually the longest step.",
    };
  if (status === "failed")
    return {
      title: "Creation paused",
      detail: "Review the message above for the safest next step.",
    };
  return {
    title: "Your request is safely queued",
    detail: "We’ll update this screen automatically.",
  };
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean, busyText = "Working…"): void {
  if (busy) {
    button.dataset.originalContent = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${busyText}</span>`;
    return;
  }
  button.disabled = false;
  button.removeAttribute("aria-busy");
  if (button.dataset.originalContent) button.innerHTML = button.dataset.originalContent;
}

function setActionFeedback(message: string, tone: "success" | "error" | "neutral"): void {
  const feedback = document.querySelector<HTMLElement>("#action-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `action-feedback ${tone}`;
  feedback.hidden = false;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "within 24 hours";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function groupTemplatesByCollection(
  templates: readonly TemplateSummary[],
): Map<string, TemplateSummary[]> {
  const collections = new Map<string, TemplateSummary[]>();
  for (const template of templates) {
    const items = collections.get(template.collection) ?? [];
    items.push(template);
    collections.set(template.collection, items);
  }
  return collections;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadingContent(): string {
  return `<main class="page-shell loading-shell" aria-busy="true"><header class="topbar"><span class="brand">memory<span>reels</span></span></header><section class="panel loading-panel"><div class="loading-mark" aria-hidden="true"></div><p>Opening your private reel studio…</p></section></main>`;
}

function unavailableContent(): string {
  return `
    <main class="page-shell">
      <header class="topbar"><span class="brand">memory<span>reels</span></span></header>
      <section class="panel empty-state">
        <p class="eyebrow">Connection paused</p>
        <h1>Memory Reels couldn’t open</h1>
        <p class="lede">The local app service is unavailable. Start it, then try again—your browser has not submitted anything.</p>
        <button id="retry-app" class="button button-primary">Try again</button>
      </section>
    </main>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}
