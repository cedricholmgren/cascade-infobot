import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

//get request
export default async (req, res) => {
  try {
    //use the assistant id in the request body to retrieve the assistant. Otherwise use the default assistant
    const assistant = await openai.beta.assistants.retrieve(
      req.body.assistantId
    );
    //check if thread id is in the request body, if it is null, then create a new thread, if not, use the thread id in the request body
    let thread;
    if (req.body.threadId === null) {
      thread = await openai.beta.threads.create();
      console.log("thread not recieved", thread);
    } else {
      thread = await openai.beta.threads.retrieve(req.body.threadId);
      console.log("thread recieved", thread);
    }
    console.log("thread", thread);

    //create a message from the request body
    const message = await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: req.body.content,
    });

    //create a run from the thread and the message
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });

    // Wait for the run to complete or timeout after 20 seconds
    const startTime = Date.now();
    const timeout = 60000; // 20 seconds
    let runStatus = null;

    do {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        console.log("Operation timed out.");
        await openai.beta.threads.runs.cancel(thread.id, run.id);
        break;
      }

      //if the run status is failed, then cancel the run
      if (runStatus === "failed") {
        console.log("Operation failed.");
        await openai.beta.threads.runs.cancel(thread.id, run.id);
        break;
      }

      // Polling the run status
      const currentRun = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );
      runStatus = currentRun.status;
      console.log(`Current run status: ${runStatus}`);

      if (runStatus === "completed") {
        // Retrieve final messages from the thread
        const finalMessages = await openai.beta.threads.messages.list(
          thread.id
        );
        // Retrieve the last assistant message from the thread
        const lastAssistantMessage = finalMessages.body.data.find(
          (message) => message.role === "assistant"
        );

        //console.log the final assistant message and include the html content
        //get the content that is this format content: [ { type: 'text', text: [Object] } ],
        console.log("lastAssistantMessage", lastAssistantMessage.content);

        const price =
          (currentRun.usage.prompt_tokens / 1000) * 0.01 +
          (currentRun.usage.completion_tokens / 1000) * 0.03;

        console.log("price", price);

        if (lastAssistantMessage) {
          // Convert text formatting to HTML
          const responseContent = lastAssistantMessage.content
            .map((item) => {
              if (item.type === "text") {
                // Convert line breaks to <br> tags
                const htmlContent = item.text.value.replace(/\n/g, "<br>");
                console.log("HTML formatted content", htmlContent);
                return htmlContent;
              }
              // Include logic for other types if necessary
              return `Unsupported content type: ${item.type}`;
            })
            .join(""); // Join all HTML content

          // Send the last assistant message's content back along with the thread ID
          res.status(200).json({
            message: responseContent,
            threadId: thread.id, // Include the thread ID in the response
          });
        } else {
          // Handle the case where no assistant messages were found
          res.status(404).json({
            message: "No assistant messages found in the thread.",
            threadId: thread.id, // Include the thread ID for reference
          });
        }
        return;
      }

      // Wait for a short period before polling again to avoid hitting rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
    } while (runStatus !== "completed");

    if (runStatus !== "completed") {
      // Handle cases where the run did not complete within the timeout
      res.status(408).json({ message: "Request timed out." });
    }
    res.status(200).json(assistant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
