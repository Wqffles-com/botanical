import { createInterface } from "node:readline";

import { dispatch, type RpcMessage } from "./protocol.js";

const input = createInterface({ input: process.stdin, terminal: false });

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: RpcMessage;
  try {
    message = JSON.parse(trimmed) as RpcMessage;
  } catch {
    return;
  }
  if (message.method === "tools/call" && message.params?.name === "slow") {
    setTimeout(() => {
      const response = dispatch(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }, 5_000);
    return;
  }
  const response = dispatch(message);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});
