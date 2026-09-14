// Isolated integration-test harness, never included in the packaged application.
const { AgentGateway } = require("../dist/agent.js");
let input = "";
process.stdin.on("data", async (chunk) => {
  input += chunk;
  if (!input.includes("\n")) return;
  const config = JSON.parse(input.trim());
  input = "";
  const gateway = new AgentGateway(
    config.dataDir,
    () => config.service,
    () => {},
  );
  await gateway.setEnabled(true);
  process.stdout.write("ready\n");
  process.stdin.on("end", async () => {
    await gateway.stop();
    process.exit(0);
  });
});
