// main.ts
import { BiHTTPServer } from "./lib/server.ts";
import { BiHTTPClient } from "./lib/client.ts";

async function runServer() {
  const biServer = new BiHTTPServer();

  // Handle incoming messages
  biServer.onMessage((message, clientId) => {
    console.log(`Server received from client ${clientId}:`, message);

    // Echo the message back
    biServer.sendMessage(clientId, {
      type: "echo",
      originalMessage: message,
      timestamp: new Date().toISOString(),
    });

    // Also broadcast to everyone
    biServer.broadcastMessage({
      type: "broadcast",
      from: clientId,
      content: message,
      timestamp: new Date().toISOString(),
    });
  });

  // Start the server
  const port = 8080;
  console.log(`BiHTTP server listening on port ${port}`);

  Deno.serve({ port }, biServer.handler());
}

// Client demo
async function runClient() {
  console.log("Starting BiHTTP client...");
  const client = new BiHTTPClient("http://localhost:8080");

  // Handle incoming messages
  client.onMessage((message) => {
    console.log("Client received:", message);
  });

  try {
    await client.connect();
    console.log("Client connected with ID:", client.getClientId());

    // Send messages periodically
    let counter = 0;
    const interval = setInterval(() => {
      if (!client.isConnected()) {
        clearInterval(interval);
        return;
      }

      counter++;
      client.sendMessage({
        type: "greeting",
        counter,
        text: `Hello from client ${client.getClientId()}!`,
        timestamp: new Date().toISOString(),
      });

      if (counter >= 5) {
        clearInterval(interval);
        setTimeout(() => {
          console.log("Client disconnecting...");
          client.disconnect();
        }, 1000);
      }
    }, 2000);
  } catch (error) {
    console.error("Client error:", error);
  }
}

// Run the server and client
if (import.meta.main) {
  // In a real application, these would typically run in separate processes
  runServer();

  // Wait for server to start before running client
  setTimeout(runClient, 1000);
}
