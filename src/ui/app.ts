import {
  createDraft,
  deleteJob,
  enableLocalLiveSubmission,
  fetchGenerationProposal,
  fetchJob,
  fetchSession,
  fetchStorageHealth,
  fetchTemplates,
  resetLocalDemo,
  submitFixture,
  submitLiveGeneration,
  uploadSource,
} from "../api/product";
import type { GenerationProposal, Job, Template, UserIdentity } from "../domain/types";
import { weddingPortraitTemplate as fixtureTemplate } from "../fixtures/template";

type Screen =
  "catalogue" | "upload" | "validated" | "proposal" | "rejected" | "progress" | "delivery";

const screens: Record<Screen, { eyebrow: string; title: string; step: number }> = {
  catalogue: { eyebrow: "Memory Reels", title: "Choose a gentle moment", step: 1 },
  upload: { eyebrow: "Wedding portrait comes alive", title: "Choose a photo that fits", step: 2 },
  validated: { eyebrow: "Photo check", title: "This photo is ready", step: 3 },
  proposal: { eyebrow: "Live request review", title: "Review before any charge", step: 4 },
  rejected: { eyebrow: "Photo check", title: "This file needs replacing", step: 3 },
  progress: { eyebrow: "Your reel", title: "Creating your reel", step: 4 },
  delivery: { eyebrow: "Your reel", title: "Your reel is ready", step: 5 },
};

export async function renderApp(root: HTMLDivElement): Promise<void> {
  let current: Screen = readScreen();
  let user: UserIdentity | null = null;
  let template: Template = fixtureTemplate;
  let validatedJobId: string | null = window.sessionStorage.getItem(
    "memory-reels-validated-job-id",
  );
  let submissionError: string | null = null;
  let proposal: GenerationProposal | null = null;
  let storageHealth: { configured: boolean; accessible: boolean } | null = null;
  let activeJob: Job | null = null;
  let pollingJobId: string | null = null;

  try {
    const [session, templates] = await Promise.all([fetchSession(), fetchTemplates()]);
    user = session;
    template = templates[0] ?? fixtureTemplate;
  } catch {
    root.innerHTML = `<main class="page-shell"><section class="hero"><p class="eyebrow">Local API unavailable</p><h1>Start the local app server</h1><p class="lede">Run <code>npm run dev</code> from <code>apps/web</code>, then reload this page.</p></section></main>`;
    return;
  }

  const go = (next: Screen): void => {
    current = next;
    window.history.pushState({}, "", `#${next}`);
    draw();
  };

  window.addEventListener("popstate", () => {
    current = readScreen();
    draw();
  });

  function draw(): void {
    const content = screenContent(
      current,
      template,
      user,
      validatedJobId,
      proposal,
      storageHealth,
      activeJob,
    );
    root.innerHTML = `
      <main class="page-shell">
        <header class="topbar">
          <a class="brand" href="#catalogue" aria-label="Memory Reels home">memory<span>reels</span></a>
          <span class="prototype-tag">${user ? `Signed in as ${user.displayName}` : "Sign-in required"}</span>
        </header>
        <section class="progress-track" aria-label="Demo progress">
          ${[1, 2, 3, 4, 5]
            .map(
              (step) =>
                `<span class="progress-dot ${step <= screens[current].step ? "is-active" : ""}">${step}</span>`,
            )
            .join("")}
        </section>
        <section class="hero" aria-labelledby="screen-title">
          <p class="eyebrow">${screens[current].eyebrow}</p>
          <h1 id="screen-title">${screens[current].title}</h1>
          ${submissionError ? `<p class="error-notice" role="alert">${submissionError}</p>` : ""}${content}
        </section>
        <p class="prototype-notice">Local development build. Live generation occurs only after the output and maximum cost are shown and approved.</p>
      </main>
    `;

    document.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((button) => {
      button.addEventListener("click", () => go(button.dataset.go as Screen));
    });
    document
      .querySelector<HTMLButtonElement>("#validate-source")
      ?.addEventListener("click", async () => {
        const file = document.querySelector<HTMLInputElement>("#source-file")?.files?.[0];
        if (!file) return;
        try {
          const permissionConfirmed =
            document.querySelector<HTMLInputElement>("#permission-confirmed")?.checked ?? false;
          const draft = await createDraft(template.id, permissionConfirmed);
          const job = await uploadSource(draft.id, file);
          validatedJobId = job.id;
          window.sessionStorage.setItem("memory-reels-validated-job-id", job.id);
          go(job.status === "validated" ? "validated" : "rejected");
        } catch {
          go("rejected");
        }
      });
    document
      .querySelector<HTMLButtonElement>("#review-live")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) return go("upload");
        submissionError = null;
        try {
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          go("proposal");
        } catch (error) {
          submissionError =
            error instanceof Error ? error.message : "Could not prepare the request.";
          draw();
        }
      });
    document
      .querySelector<HTMLButtonElement>("#submit-live")
      ?.addEventListener("click", async () => {
        if (!validatedJobId || !proposal) return;
        submissionError = null;
        try {
          activeJob = await submitLiveGeneration(validatedJobId, proposal);
          go(activeJob.status === "failed" ? "proposal" : "progress");
          if (activeJob.status !== "failed") void pollUntilTerminal(validatedJobId);
          else {
            submissionError = activeJob.error?.message ?? "The request was not accepted.";
            draw();
          }
        } catch (error) {
          submissionError = error instanceof Error ? error.message : "Could not create this reel.";
          draw();
        }
      });
    document
      .querySelector<HTMLInputElement>("#approve-live-cost")
      ?.addEventListener("change", (event) => {
        const button = document.querySelector<HTMLButtonElement>("#submit-live");
        const checkbox = event.currentTarget as HTMLInputElement;
        if (button) button.disabled = !checkbox.checked;
      });
    document
      .querySelector<HTMLButtonElement>("#enable-live-test")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) return;
        submissionError = null;
        try {
          await enableLocalLiveSubmission();
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          draw();
        } catch (error) {
          submissionError = error instanceof Error ? error.message : "Could not enable testing.";
          draw();
        }
      });
    document
      .querySelector<HTMLButtonElement>("#retry-configuration")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) return;
        submissionError = null;
        try {
          [proposal, storageHealth] = await Promise.all([
            fetchGenerationProposal(validatedJobId),
            fetchStorageHealth(),
          ]);
          draw();
        } catch (error) {
          submissionError = error instanceof Error ? error.message : "Could not recheck setup.";
          draw();
        }
      });
    document
      .querySelector<HTMLButtonElement>("#submit-fixture")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) {
          window.alert("Select and validate a photo before creating the local fixture reel.");
          go("upload");
          return;
        }
        try {
          activeJob = await submitFixture(validatedJobId);
          go("progress");
          void pollUntilTerminal(validatedJobId);
        } catch (error) {
          submissionError = error instanceof Error ? error.message : "Could not create this reel.";
          draw();
        }
      });
    document
      .querySelector<HTMLButtonElement>("#reset-local-demo")
      ?.addEventListener("click", async () => {
        await resetLocalDemo();
        window.sessionStorage.removeItem("memory-reels-validated-job-id");
        validatedJobId = null;
        proposal = null;
        activeJob = null;
        submissionError = null;
        go("catalogue");
      });
    document
      .querySelector<HTMLButtonElement>("#delete-fixture")
      ?.addEventListener("click", async () => {
        if (!validatedJobId) return;
        await deleteJob(validatedJobId);
        window.sessionStorage.removeItem("memory-reels-validated-job-id");
        validatedJobId = null;
        go("catalogue");
      });
  }

  async function pollUntilTerminal(jobId: string): Promise<void> {
    if (pollingJobId === jobId) return;
    pollingJobId = jobId;
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      try {
        activeJob = await fetchJob(jobId);
        if (activeJob.status === "completed") {
          pollingJobId = null;
          return go("delivery");
        }
        if (activeJob.status === "failed") {
          pollingJobId = null;
          submissionError = activeJob.error?.message ?? "Video generation did not complete.";
          return draw();
        }
        draw();
      } catch {
        pollingJobId = null;
        submissionError = "Could not refresh generation status. Reload to try again.";
        return draw();
      }
    }
  }

  draw();
  if (current === "progress" && validatedJobId) void pollUntilTerminal(validatedJobId);
}

function readScreen(): Screen {
  const candidate = window.location.hash.slice(1);
  return isScreen(candidate) ? candidate : "catalogue";
}

function isScreen(value: string): value is Screen {
  return Object.prototype.hasOwnProperty.call(screens, value);
}

function screenContent(
  screen: Screen,
  template: Template,
  user: UserIdentity | null,
  jobId: string | null,
  proposal: GenerationProposal | null,
  storageHealth: { configured: boolean; accessible: boolean } | null,
  activeJob: Job | null,
): string {
  switch (screen) {
    case "catalogue":
      return catalogueContent(template, user);
    case "upload":
      return uploadContent(template);
    case "validated":
      return validatedContent(template);
    case "proposal":
      return proposalContent(proposal, storageHealth);
    case "rejected":
      return rejectedContent();
    case "progress":
      return progressContent(activeJob);
    case "delivery":
      return deliveryContent(jobId);
  }
}

function catalogueContent(template: Template, user: UserIdentity | null): string {
  return `
    <p class="lede">One clear memory. One restrained, five-second vertical reel.</p>
    <article class="template-card">
      <div class="preview-art" aria-label="Illustrative template preview placeholder">
        <span>5 seconds</span><strong>9:16</strong>
      </div>
      <div class="template-copy">
        <p class="card-kicker">Single template · 1 credit</p>
        <h2>${template.title}</h2>
        <p>${template.description}</p>
        <ul class="mini-list">
          <li>One or two adults</li><li>Slow, stable motion only</li><li>Private MP4 delivery</li>
        </ul>
        ${user ? '<button class="button button-primary" data-go="upload">Choose this moment</button>' : '<a class="button button-primary" href="/api/auth/google/start">Sign in with Google</a>'}
      </div>
    </article>
    <p class="quiet-copy">No free-form prompts. The template controls the intended motion for a more consistent result.</p>
  `;
}

function uploadContent(template: Template): string {
  return `
    <p class="lede">Use a clear portrait where the people and their faces are easy to see.</p>
    <div class="guidance-grid">
      <section class="guidance good"><h2>Works best</h2><ul>${template.eligibilityRules.map((rule) => `<li>${rule}</li>`).join("")}</ul></section>
      <section class="guidance avoid"><h2>Not supported in beta</h2><ul>${template.unsupportedRules.map((rule) => `<li>${rule}</li>`).join("")}</ul></section>
    </div>
    <label class="consent" for="source-file">Choose a JPEG, PNG, or WebP photo<input id="source-file" type="file" accept="image/jpeg,image/png,image/webp" /></label>
    <label class="consent"><input id="permission-confirmed" type="checkbox" /> I confirm I have permission from everyone shown to create this reel.</label>
    <div class="button-row">
      <button id="validate-source" class="button button-primary">Validate selected photo</button>
      <button class="button button-secondary" data-go="rejected">See corrupt-file example</button>
    </div>
  `;
}

function validatedContent(template: Template): string {
  return `
    <div class="status-card success"><p class="status-icon">✓</p><h2>Photo accepted</h2><p>The server fully decoded, normalized, and privately stored this image. No video request has been sent.</p></div>
    <dl class="summary"><div><dt>Template</dt><dd>${template.title}</dd></div><div><dt>Output</dt><dd>One 5-second vertical reel</dd></div><div><dt>Live maximum</dt><dd>US$0.35 for one output</dd></div></dl>
    <button id="review-live" class="button button-primary">Review live request</button>
    <button id="submit-fixture" class="button button-secondary">Test no-charge fixture</button>
    <button id="reset-local-demo" class="button button-secondary">Reset local demo</button>
  `;
}

function proposalContent(
  proposal: GenerationProposal | null,
  storage: { configured: boolean; accessible: boolean } | null,
): string {
  if (!proposal)
    return `<p class="lede">Return to the accepted photo and prepare the request again.</p><button class="button button-secondary" data-go="validated">Back</button>`;
  const ready =
    proposal.providerConfigured && proposal.liveSubmissionEnabled && storage?.accessible === true;
  return `
    <p class="lede">Create one gentle cinematic reel from the photo you just approved.</p>
    <dl class="summary">
      <div><dt>Template</dt><dd>Wedding portrait comes alive</dd></div>
      <div><dt>Output</dt><dd>One 5-second vertical reel</dd></div>
      <div><dt>Motion</dt><dd>Warm expression and subtle cinematic movement</dd></div>
      <div><dt>Maximum test cost</dt><dd><strong>US$${proposal.estimatedMaximumCostUsd.toFixed(2)}</strong></dd></div>
    </dl>
    <div class="status-card ${ready ? "success" : "warning"}"><h2>${ready ? "Ready for your test" : "Testing setup needs attention"}</h2><p>${configurationMessage(proposal, storage)}</p></div>
    ${ready ? '<label class="consent approval-consent"><input id="approve-live-cost" type="checkbox" /> I approve one live test costing no more than US$0.35.</label>' : ""}
    <div class="button-row">
      ${!proposal.liveSubmissionEnabled ? '<button id="enable-live-test" class="button button-primary">Enable live test mode</button>' : ""}
      ${proposal.liveSubmissionEnabled && storage?.accessible !== true ? '<button id="retry-configuration" class="button button-primary">Retry S3 check</button>' : ""}
      ${ready ? '<button id="submit-live" class="button button-primary" disabled>Create my reel</button>' : ""}
      <button class="button button-secondary" data-go="validated">Back without submitting</button>
    </div>
    <p class="quiet-copy">No generation is submitted until you check the approval box and press Create my reel.</p>
  `;
}

function configurationMessage(
  proposal: GenerationProposal,
  storage: { configured: boolean; accessible: boolean } | null,
): string {
  if (!proposal.providerConfigured)
    return "The video service key is missing. Add it to apps/web/.env and restart the app.";
  if (!proposal.liveSubmissionEnabled)
    return "The paid test switch is locked. Enable local live test mode below; this does not submit or charge anything.";
  if (!storage?.configured)
    return "Private S3 storage is not configured. Add the region and bucket to apps/web/.env, then restart.";
  if (!storage.accessible)
    return "The app cannot access the private S3 bucket. Check the AWS credentials and bucket permissions, restart if configuration changed, then retry.";
  return "Private storage and the video service are configured. Nothing has been submitted yet.";
}

function rejectedContent(): string {
  return `
    <div class="status-card warning"><p class="status-icon">!</p><h2>Invalid image source</h2><p>This fixture represents a corrupt or incomplete image file. Replace it with a fresh JPEG, PNG, or WebP; it would never reach a video provider.</p></div>
    <p class="quiet-copy">Safe error code: <code>invalid_image_source</code>. No credit is reserved, and no generation is queued.</p>
    <button class="button button-primary" data-go="upload">Return to photo guidance</button>
  `;
}

function progressContent(job: Job | null): string {
  const status = job?.status ?? "queued";
  return `
    <div class="reel-loader" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="lede centered">Current status: ${escapeHtml(status)}</p>
    <div class="timeline"><p><b>Queued</b><span>Provider accepted the request</span></p><p><b>Generating</b><span>Kling is creating the motion</span></p><p><b>Storing</b><span>Copying the MP4 into private S3 storage</span></p></div>
    <p class="quiet-copy">This screen polls persisted server state. You can reload without creating another request.</p>
  `;
}

function deliveryContent(jobId: string | null): string {
  return `
    ${jobId ? `<video class="delivery-video" controls playsinline src="/api/jobs/${jobId}/delivery"></video>` : '<div class="delivery-frame"><strong>Delivery unavailable</strong></div>'}
    <div class="status-card success compact"><h2>Private delivery ready</h2><p>AI-generated video. Review the identity, face, hands, motion, prompt adherence, and usability before sharing.</p></div>
    <div class="button-row"><a class="button button-primary" href="${jobId ? `/api/jobs/${jobId}/delivery?download=1` : "#"}" download>Download reel</a><button id="delete-fixture" class="button button-secondary">Delete source and reel</button></div>
    <p class="quiet-copy">Only the signed-in job owner can access this delivery. It expires after 24 hours in this prototype.</p>
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
