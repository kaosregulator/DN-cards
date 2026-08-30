// A local stand-in for an emoji editor, used to exercise the discovery tooling
// and the browser provider end to end without depending on a third-party site.
//
// It is NOT a model of MakeEmoji — we have never seen MakeEmoji's DOM. It is a
// generic editor (file input, option selects, a generate button, a blob preview
// and a download link) whose only job is to prove the automation can drive a
// page of that shape: upload, set options, trigger, retrieve bytes.

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const html = () => readFileSync(fileURLToPath(new URL("editor.html", import.meta.url)));
const js = () => readFileSync(fileURLToPath(new URL("editor.js", import.meta.url)));

export interface FixtureSite {
  url: string;
  close(): Promise<void>;
}

export async function startFixtureSite(): Promise<FixtureSite> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/editor.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js());
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html());
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
