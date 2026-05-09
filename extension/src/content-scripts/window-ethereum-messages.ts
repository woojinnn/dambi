import { WindowPostMessageStream } from "@metamask/post-message-stream";
import Browser from "webextension-polyfill";
import { Identifier } from "@lib/identifier";
import { sendToPortAndAwaitResponse } from "@lib/messages";
import type { Message, StreamResponse } from "@lib/types";

console.log('[Scopeball-bridge] alive on', location.href);

const stream = new WindowPostMessageStream({
  name: Identifier.CONTENT_SCRIPT,
  target: Identifier.INPAGE,
}) as WindowPostMessageStream & {
  on(event: "data", callback: (message: Message) => void): void;
  write(data: StreamResponse): boolean;
};

console.log('[Scopeball-bridge] stream listener installed');

stream.on("data", async (message: Message) => {
  // Drop anything that doesn't look like a real wallet-action envelope.
  // BasePostMessageStream can deliver post-init handshake echoes ("SYN"/
  // "ACK" strings) up to the data handler in some delivery races. Those
  // would crash logging and silently push junk through to the SW, where
  // the wallet-action filter would drop them — looking from outside as if
  // the proxy never reached us.
  if (
    !message ||
    typeof message !== "object" ||
    !("data" in message) ||
    !message.data ||
    typeof message.data !== "object" ||
    !("type" in message.data)
  ) {
    return;
  }
  console.log(
    "[Scopeball-bridge] received from inpage:",
    message.data.type,
    message.requestId,
    "frame:", location.href,
  );
  let port: Browser.Runtime.Port;
  try {
    port = Browser.runtime.connect({ name: Identifier.CONTENT_SCRIPT });
    console.log("[Scopeball-bridge] port connected for", message.requestId);
  } catch (err) {
    console.error("[Scopeball-bridge] port.connect failed for", message.requestId, err);
    stream.write({ requestId: message.requestId, data: true });
    return;
  }
  const data: Message["data"] = {
    ...message.data,
    hostname: location.hostname,
  };
  port.onMessage.addListener((msg: any) => {
    if (msg?.kind === "awaiting-user" && msg.requestId === message.requestId) {
      stream.write({ requestId: message.requestId, kind: "awaiting-user" });
    }
  });
  port.onDisconnect.addListener(() => {
    console.warn("[Scopeball-bridge] port disconnected for", message.requestId, Browser.runtime.lastError);
  });
  console.log("[Scopeball-bridge] posting to SW for", message.requestId);
  const ok = await sendToPortAndAwaitResponse(port, data);
  console.log("[Scopeball-bridge] SW responded for", message.requestId, "ok:", ok);
  stream.write({ requestId: message.requestId, data: ok });
  port.disconnect();
});
