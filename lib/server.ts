export class BiHTTPServer {
  private clients: Map<string, ReadableStreamDefaultController<Uint8Array>> =
    new Map();
  private messageHandlers: Set<(message: unknown, clientId: string) => void> =
    new Set();

  // Register a message handler
  public onMessage(
    handler: (message: unknown, clientId: string) => void,
  ): void {
    this.messageHandlers.add(handler);
  }

  // Unregister a message handler
  public removeMessageHandler(
    handler: (message: unknown, clientId: string) => void,
  ): void {
    this.messageHandlers.delete(handler);
  }

  // Send a message to a specific client
  public sendMessage(clientId: string, message: unknown): boolean {
    const controller = this.clients.get(clientId);
    if (!controller) return false;

    try {
      const messageStr = JSON.stringify(message) + "\n";
      controller.enqueue(new TextEncoder().encode(messageStr));
      return true;
    } catch (error) {
      console.error(`Error sending message to client ${clientId}:`, error);
      return false;
    }
  }

  // Broadcast a message to all connected clients
  public broadcastMessage(message: unknown): void {
    for (const clientId of this.clients.keys()) {
      this.sendMessage(clientId, message);
    }
  }

  // HTTP handler for the BiHTTP protocol
  public handler() {
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const clientId = url.searchParams.get("clientId") || crypto.randomUUID();

      // Handle GET request (server-to-client messages)
      if (request.method === "GET") {
        // Create a stream for sending messages to the client
        const stream = new ReadableStream({
          start: (controller) => {
            this.clients.set(clientId, controller);
          },
          cancel: () => {
            this.clients.delete(clientId);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Connection": "keep-alive",
            "X-Client-ID": clientId,
            "Cache-Control": "no-cache",
          },
        });
      }

      // Handle POST request (client-to-server messages)
      if (request.method === "POST") {
        if (!request.body) {
          return new Response("No request body", { status: 400 });
        }

        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete messages (separated by newline)
            const messages = buffer.split("\n");
            buffer = messages.pop() || ""; // Keep the last incomplete message

            for (const msgStr of messages) {
              if (msgStr.trim()) {
                try {
                  const message = JSON.parse(msgStr);
                  // Notify all message handlers
                  for (const handler of this.messageHandlers) {
                    handler(message, clientId);
                  }
                } catch (error) {
                  console.error("Error parsing message:", error);
                }
              }
            }
          }

          // Process any remaining data
          decoder.decode(new Uint8Array(0));

          return new Response("OK", {
            headers: {
              "X-Client-ID": clientId,
            },
          });
        } catch (error) {
          console.error("Error processing client message:", error);
          return new Response("Error processing message", { status: 500 });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    };
  }
}
