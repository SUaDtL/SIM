import { expect, type Page, test } from "@playwright/test";

/** Browser boundary observations; this does not supply native file/permission proof. */
export function observeRuntime(page: Page) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (!/^(file|blob|data):/.test(request.url())) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return {
    async check(stage: string): Promise<void> {
      const storage = await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        databases: (await indexedDB.databases()).map((database) => database.name),
      }));
      await test.info().attach(`runtime-boundary-${stage}`, {
        body: JSON.stringify({ stage, requests, errors, storage }),
        contentType: "application/json",
      });
      expect(requests, `External requests at ${stage}`).toEqual([]);
      expect(errors, `Runtime/CSP errors at ${stage}`).toEqual([]);
      expect(storage, `Browser-persistent data at ${stage}`).toEqual({ local: 0, session: 0, databases: [] });
    },
  };
}
