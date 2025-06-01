export class BiHTTPClient {
  private serverUrl: string;
  private clientId: string | null = null;
  private getController: AbortController | null = null;
  private postController: AbortController | null = null;
  private messageHandlers: Set<(message: unknown) => void> = new Set();
  private connected = false;
  private postBodyWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getClientId(): string | null {
    return this.clientId;
  }

  // Register a message handler
  public onMessage(handler: (message: unknown) => void): void {
    this.messageHandlers.add(handler);
  }

  // Connect to the server
  public async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected");
    }

    try {
      // Setup GET connection (server-to-client)
      await this.setupGetConnection();

      // Setup POST connection (client-to-server)
      this.setupPostConnection();

      this.connected = true;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  // Disconnect from the server
  public disconnect(): void {
    this.connected = false;

    if (this.getController) {
      this.getController.abort();
      this.getController = null;
    }

    if (this.postController) {
      this.postController.abort();
      this.postController = null;
    }

    if (this.postBodyWriter) {
      this.postBodyWriter.close().catch(console.error);
      this.postBodyWriter = null;
    }
  }

  // Send a message to the server
  public async sendMessage(message: unknown): Promise<boolean> {
    if (!this.connected || !this.postBodyWriter) {
      return false;
    }

    try {
      const messageStr = JSON.stringify(message) + "\n";
      await this.postBodyWriter.write(new TextEncoder().encode(messageStr));
      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  }

  private async setupGetConnection(): Promise<void> {
    this.getController = new AbortController();

    const url = new URL(this.serverUrl);
    if (this.clientId) {
      url.searchParams.set("clientId", this.clientId);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      signal: this.getController.signal,
    });

    if (!response.ok) {
      throw new Error(
        `GET connection failed: ${response.status} ${response.statusText}`,
      );
    }

    // Store the client ID from the response headers
    this.clientId = response.headers.get("X-Client-ID") || this.clientId;

    if (!response.body) {
      throw new Error("Response body is null");
    }

    this.processServerMessages(response.body);
  }

  private setupPostConnection() {
    this.postController = new AbortController();

    const url = new URL(this.serverUrl);
    if (this.clientId) {
      url.searchParams.set("clientId", this.clientId);
    }

    // Create a stream for sending messages
    const { readable, writable } = new TransformStream();
    this.postBodyWriter = writable.getWriter();

    // Initiate the POST request
    fetch(url.toString(), {
      method: "POST",
      body: readable,
      signal: this.postController.signal,
      headers: {
        "Content-Type": "application/json",
      },
      duplex: "half",
    } as RequestInit).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.log("POST connection aborted");
      } else {
        console.error("POST connection error:", error);
      }
      this.disconnect();
    });
  }

  private async processServerMessages(
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = body.getReader();
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
                handler(message);
              }
            } catch (error) {
              console.error("Error parsing server message:", error);
            }
          }
        }
      }
    } catch (error) {
      if (this.connected) {
        console.error("Error processing server messages:", error);
        this.disconnect();
      }
    }
  }
}
