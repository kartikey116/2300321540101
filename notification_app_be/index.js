import express from 'express';
import axios from 'axios';
import Log from '../logging_middleware/logger.js';
import { getPriorityNotifications } from './priority.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT_NOTIFICATION || 5001;

app.get('/priority-notifications', async (req, res) => {
  const token = process.env.ACCESS_TOKEN;

  if (!token || token === "PASTE_YOUR_ACCESS_TOKEN_HERE") {
    const errorMsg = "ACCESS_TOKEN is not configured. Please paste again the new token";
    console.error(errorMsg);
    await Log("backend", "error", "handler", errorMsg);
    return res.status(401).json({
      status: "error",
      message: errorMsg
    });
  }

  try {
    await Log("backend", "info", "handler", "Priority inbox request received.");

    let response;
    try {
      await Log("backend", "info", "service", "Fetching notifications list from test server.");
      response = await axios.get("http://4.224.186.213/evaluation-service/notifications", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (apiError) {
      const detailedError = apiError.response?.data 
        ? JSON.stringify(apiError.response.data) 
        : apiError.message;
      const msg = `Failed to fetch notifications from evaluation service: ${detailedError}`;
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    const notifications = response.data.notifications;
    if (!notifications || !Array.isArray(notifications)) {
      const msg = "Invalid notifications data received from test server.";
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    await Log("backend", "info", "service", `Successfully fetched ${notifications.length} raw notifications.`);

    const priorityList = getPriorityNotifications(notifications, 10);

    await Log("backend", "info", "handler", "Successfully processed priority inbox sorting.");

    return res.status(200).json({
      status: "success",
      data: {
        notifications: priorityList
      }
    });

  } catch (error) {
    const errorMsg = `Unhandled exception in /priority-notifications handler: ${error.message}`;
    console.error(error);
    try {
      await Log("backend", "fatal", "handler", errorMsg);
    } catch (logError) {
      console.error("Failed to log fatal error:", logError.message);
    }
    return res.status(500).json({
      status: "error",
      message: "Internal server error during priority inbox sorting."
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: "UP" });
});

app.listen(PORT, () => {
  console.log(`Campus Notifications Microservice is listening on port ${PORT}`);
});
