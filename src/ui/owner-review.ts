import {
  applyCorrections,
  MAX_REVIEW_BYTES,
  parseReturn,
  prepareCorrections,
  prepareReview,
  renderReviewPack,
  reviewDigest,
  type Difference,
  type Issuance,
  type ReviewBase,
} from "../assessment/review";
import { bannerText } from "../db/markings";
import { SensitiveInputWarning } from "../domain/errors";
import type { Repository } from "../domain/repository";
import { downloadBlob } from "../file/dataset-file";
import { button, el, option } from "./dom";

function reviewDialog(title: string) {
  const origin = document.querySelector<HTMLElement>("details.file-menu:not(.about-menu) > summary");
  const heading = el("h2", { id: "owner-review-heading", tabindex: "-1" }, title);
  const dialog = el("dialog", { class: "assessment-dialog decision-dialog", "aria-labelledby": heading.id });
  const body = el("div");
  const alert = el("p", { role: "alert", class: "error" });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  dialog.append(heading, alert, body);
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
  const fail = (error: unknown): void => {
    alert.textContent = error instanceof Error ? error.message : "The review operation could not be completed.";
  };
  return { dialog, heading, body, alert, fail };
}

export function openReviewIssuance(
  repo: Repository,
  isSaved: (id: string, digest: string) => boolean,
  saveBase: () => Promise<void>,
): HTMLDialogElement {
  const { dialog, heading, body, alert, fail } = reviewDialog("Prepare owner review");
  const query = el("input", { type: "search" });
  const teams = el("select");
  const includeNotes = el("input", { type: "checkbox" });
  const issueList = el("ul");
  function updateTeams(): void {
    const filtered = repo
      .listOrganizations()
      .filter(({ name }) => name.toLowerCase().includes(query.value.trim().toLowerCase()));
    teams.replaceChildren(
      option("", "Choose an organization"),
      ...filtered.slice(0, 50).map(({ id, name }) => option(String(id), name)),
    );
  }
  query.addEventListener("input", updateTeams);

  async function exportPack(issuance: Issuance): Promise<void> {
    try {
      if (!isSaved(issuance.base.id, issuance.digest))
        throw new Error(
          "Save the dataset first. For a downloaded dataset, reopen that saved file before exporting the review.",
        );
      const actual = await reviewDigest(issuance.base);
      if (!dialog.open) return;
      if (actual !== issuance.digest || !isSaved(issuance.base.id, issuance.digest))
        throw new Error("The review could not be matched to its saved base.");
      const content = renderReviewPack(issuance);
      const blob = new Blob([content], { type: "application/json" });
      if (blob.size > MAX_REVIEW_BYTES) throw new Error("The review package exceeds 2 MB.");
      downloadBlob(blob, `SIM review ${issuance.base.id}.json`);
      alert.textContent = "Review download requested. Deliver it through your approved process.";
    } catch (error) {
      fail(error);
    }
  }

  function instructions(): void {
    alert.textContent = "";
    issueList.replaceChildren(
      ...repo.listReviewIssuances().map((item) =>
        el(
          "li",
          {},
          button(`Download review for ${item.base.team} (${item.base.issuedAt.slice(0, 10)})`, () => {
            void exportPack(item);
          }),
        ),
      ),
    );
    body.replaceChildren(
      el(
        "p",
        {},
        "A review uses recorded provider, support, and consumer roles. Save its local base before downloading the package.",
      ),
      el("label", { class: "assessment-field" }, "Find organization", query),
      el("label", { class: "assessment-field" }, "Organization", teams),
      el("label", {}, includeNotes, " Include evidence and questions linked to the team’s services"),
      button("Preview team scope", () => {
        try {
          if (!teams.value) throw new Error("Choose an organization.");
          preview(prepareReview(repo, Number(teams.value), includeNotes.checked), repo.currentRevision());
          heading.focus();
        } catch (error) {
          fail(error);
        }
      }),
      el("h3", {}, "Prepared reviews"),
      issueList,
      button("Close", () => {
        dialog.close();
      }),
    );
  }

  function preview(base: ReviewBase, revision: number): void {
    alert.textContent = "";
    const names = new Map(base.references.map((record) => [record.id, record.label]));
    const list = el(
      "ul",
      {},
      ...base.services.map((row) =>
        el(
          "li",
          {},
          el("p", {}, `${row.label} · ${row.roles.join(", ")}`),
          el(
            "details",
            {},
            el("summary", {}, "Fields included in review"),
            el(
              "dl",
              {},
              ...Object.entries(row.fields).flatMap(([field, value]) => [
                el("dt", {}, field),
                el("dd", {}, value === null ? "Not recorded" : (names.get(value) ?? value)),
              ]),
            ),
          ),
        ),
      ),
    );
    const boundaries = el(
      "details",
      {},
      el("summary", {}, `Review dependency context (${String(base.boundaries.length)})`),
      el("ul", {}, ...base.boundaries.map((row) => el("li", {}, `${row.consumer} → ${row.provider} · ${row.kind}`))),
    );
    const notes = base.notes?.length
      ? el(
          "details",
          {},
          el("summary", {}, `Included evidence and questions (${String(base.notes.length)})`),
          el(
            "ul",
            {},
            ...base.notes.map((note) =>
              el(
                "li",
                {},
                note.kind,
                el("p", {}, note.text),
                note.source ? el("p", {}, note.source) : null,
                note.response ? el("p", {}, note.response) : null,
              ),
            ),
          ),
        )
      : null;
    const create = button("Prepare and save review base", () => {
      create.disabled = true;
      void (async () => {
        try {
          const digest = await reviewDigest(base);
          if (!dialog.open) return;
          if (repo.currentRevision() !== revision)
            throw new Error("The dataset changed. Preview the team scope again.");
          repo.storeReviewIssuance({ base, digest });
          dialog.close();
          await saveBase();
        } catch (error) {
          create.disabled = false;
          fail(error);
        }
      })();
    });
    body.replaceChildren(
      el("h3", {}, base.team),
      el("p", {}, bannerText(base.marking, base.caveat)),
      el(
        "p",
        {},
        `${String(base.services.length)} services. The pack includes their descriptions, current shared assignments and support notes. Related dependencies include endpoint labels only.`,
      ),
      list,
      boundaries,
      ...(notes ? [notes] : []),
      el(
        "div",
        { class: "actions" },
        button("Back", () => {
          instructions();
          heading.focus();
        }),
        create,
      ),
    );
  }
  updateTeams();
  instructions();
  return dialog;
}

export function openCorrectionReview(
  repo: Repository,
  isSaved: (id: string, digest: string) => boolean,
  done: (count: number, receipt: Blob) => void,
): HTMLDialogElement {
  const { dialog, heading, body, alert, fail } = reviewDialog("Apply reviewed corrections");
  const picker = el("input", { type: "file", accept: ".json,application/json" });
  let latestPick = 0;
  function choose(): void {
    body.replaceChildren(
      el(
        "p",
        {},
        "Choose the returned JSON from a prepared owner review. Inspect the proposed fields and select the ones to apply.",
      ),
      el("label", { class: "assessment-field" }, "Returned review file", picker),
      button("Cancel", () => {
        dialog.close();
      }),
    );
  }

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    const request = ++latestPick;
    if (!file) return;
    alert.textContent = "";
    const ownsRequest = (): boolean => dialog.open && request === latestPick;
    void (async () => {
      try {
        if (file.size > MAX_REVIEW_BYTES) throw new Error("Review file exceeds the 2 MB limit.");
        const returned = parseReturn(await file.text());
        if (!ownsRequest()) return;
        const stored = repo.reviewIssuance(returned.issuance);
        if (!stored || !isSaved(stored.base.id, stored.digest) || (await reviewDigest(stored.base)) !== stored.digest) {
          throw new Error("The issuing base is unavailable. Compare suggestions manually using the existing editor.");
        }
        if (!ownsRequest()) return;
        const issuance: Issuance = stored;
        const differences = prepareCorrections(repo, issuance, returned);
        let page = 0;
        const selected = new Map<string, Difference>();
        function draw(): void {
          const list = el(
            "ul",
            {},
            ...differences.slice(page * 16, (page + 1) * 16).map((row) => {
              const selectable = row.disposition === "proposed" || row.disposition === "conflict";
              const checkbox = el("input", { type: "checkbox" });
              checkbox.checked = selected.has(row.key);
              checkbox.disabled = !selectable;
              checkbox.addEventListener("change", () => {
                if (checkbox.checked) selected.set(row.key, row);
                else selected.delete(row.key);
                redrawCount();
              });
              const descriptive = (value: string | null): string => {
                if (value === null) return "Not recorded";
                return issuance.base.references.find((ref) => ref.id === value)?.label ?? value;
              };
              return el(
                "li",
                {},
                el("label", {}, checkbox, `${row.label} · ${row.proposal.field} · ${row.disposition}`),
                el(
                  "p",
                  {},
                  row.reason ??
                    `Base: ${descriptive(row.base)} | Current: ${descriptive(row.current)} | Proposed: ${descriptive(row.returned)}`,
                ),
              );
            }),
          );
          const previous = button("Previous", () => {
            page--;
            draw();
            heading.focus();
          });
          const next = button("Next", () => {
            page++;
            draw();
            heading.focus();
          });
          previous.disabled = page === 0;
          next.disabled = (page + 1) * 16 >= differences.length;
          const count = el("p", { role: "status" });
          const commit = button("Apply selected corrections", () => {
            const accepted = [...selected.values()];
            try {
              let count: number;
              try {
                count = applyCorrections(repo, issuance, returned, accepted);
              } catch (error) {
                if (!(error instanceof SensitiveInputWarning)) throw error;
                if (!window.confirm(error.message)) return;
                count = applyCorrections(repo, issuance, returned, accepted, true);
              }
              receipt(
                count,
                accepted.map((row) => row.key),
              );
            } catch (error) {
              fail(error);
            }
          });
          function redrawCount(): void {
            count.textContent = `${String(selected.size)} of ${String(differences.length)} proposals selected.`;
            commit.disabled = selected.size === 0;
          }
          redrawCount();
          body.replaceChildren(
            el("p", {}, `Review for ${issuance.base.team} · Reviewer label: ${returned.reviewer || "Not recorded"}`),
            el(
              "p",
              {},
              "Selecting a conflict replaces the current value with the returned value. Other fields are kept.",
            ),
            count,
            list,
            el(
              "div",
              { class: "actions" },
              previous,
              next,
              button("Choose another file", () => {
                picker.value = "";
                choose();
                heading.focus();
              }),
              commit,
            ),
          );
        }

        function receipt(count: number, applied: string[]): void {
          const content = JSON.stringify(
            {
              format: "sim-correction-receipt/v1",
              issuance: issuance.base.id,
              sourceCheckpoint: issuance.digest,
              team: issuance.base.team,
              reviewer: returned.reviewer,
              marking: bannerText(repo.datasetMarking(), repo.datasetCaveat()),
              results: differences.map((difference) => ({
                service: difference.label,
                field: difference.proposal.field,
                disposition: difference.disposition,
                applied: applied.includes(difference.key),
              })),
            },
            null,
            2,
          );
          const output = new Blob([content], { type: "application/json" });
          done(count, output);
          body.replaceChildren(
            el("p", {}, `${String(count)} corrections applied in one Undo step. Save file to retain them.`),
            el("p", {}, "The receipt records this review. Later edits or Undo may change the dataset."),
            button("Download review receipt", () => {
              downloadBlob(output, "SIM correction receipt.json");
            }),
            button("Close", () => {
              dialog.close();
            }),
          );
          alert.textContent = "";
          heading.focus();
        }
        draw();
        heading.focus();
      } catch (error) {
        if (ownsRequest()) fail(error);
      }
    })();
  });
  choose();
  return dialog;
}
