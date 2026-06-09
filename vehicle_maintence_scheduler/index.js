import express from 'express';
import axios from 'axios';
import Log from '../logging_middleware/logger.js';
import { scheduleDepot } from './scheduler.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT_SCHEDULER || 5000;

app.get('/schedule', async (req, res) => {
  const token = process.env.ACCESS_TOKEN;

  if (!token || token === "PASTE_YOUR_ACCESS_TOKEN_HERE") {
    const errorMsg = "ACCESS_TOKEN environment variable is not configured or contains the default placeholder. Please update the .env file.";
    console.error(errorMsg);
    await Log("backend", "error", "handler", errorMsg);
    return res.status(401).json({
      status: "error",
      message: errorMsg
    });
  }

  try {
    await Log("backend", "info", "handler", "Scheduling request received and process initiated.");

    let depotsResponse;
    try {
      await Log("backend", "info", "service", "Fetching depots list from test server.");
      depotsResponse = await axios.get("http://4.224.186.213/evaluation-service/depots", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (apiError) {
      const detailedError = apiError.response?.data 
        ? JSON.stringify(apiError.response.data) 
        : apiError.message;
      const msg = `Failed to fetch depots from evaluation service: ${detailedError}`;
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    const depots = depotsResponse.data.depots;
    if (!depots || !Array.isArray(depots)) {
      const msg = "Invalid depots data received from test server.";
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    let vehiclesResponse;
    try {
      await Log("backend", "info", "service", "Fetching vehicles/tasks list from test server.");
      vehiclesResponse = await axios.get("http://4.224.186.213/evaluation-service/vehicles", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (apiError) {
      const detailedError = apiError.response?.data 
        ? JSON.stringify(apiError.response.data) 
        : apiError.message;
      const msg = `Failed to fetch vehicles from evaluation service: ${detailedError}`;
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    const vehicles = vehiclesResponse.data.vehicles;
    if (!vehicles || !Array.isArray(vehicles)) {
      const msg = "Invalid vehicles data received from test server.";
      await Log("backend", "error", "service", msg);
      return res.status(502).json({ status: "error", message: msg });
    }

    await Log("backend", "info", "service", `Successfully fetched ${depots.length} depots and ${vehicles.length} vehicle tasks.`);

    const finalSchedule = [];
    for (const depot of depots) {
      const depotId = depot.ID;
      const capacity = depot.MechanicHours;

      await Log("backend", "info", "service", `Optimizing schedule for Depot ID: ${depotId} with ${capacity} mechanic-hours.`);
      
      const { optimalTasks, totalDuration, totalImpact } = scheduleDepot(vehicles, capacity);
      
      finalSchedule.push({
        depotId,
        mechanicHoursLimit: capacity,
        totalDurationUsed: totalDuration,
        totalImpactScore: totalImpact,
        assignedTasks: optimalTasks
      });

      await Log(
        "backend", 
        "info", 
        "service", 
        `Depot ID: ${depotId} optimization completed. Assigned: ${optimalTasks.length} tasks, Duration: ${totalDuration}/${capacity} hours, Total Impact: ${totalImpact}.`
      );
    }

    await Log("backend", "info", "handler", "Successfully processed vehicle scheduling for all depots.");
    
    return res.status(200).json({
      status: "success",
      data: {
        schedule: finalSchedule
      }
    });

  } catch (error) {
    const errorMsg = `Unhandled exception in /schedule handler: ${error.message}`;
    console.error(error);
    try {
      await Log("backend", "fatal", "handler", errorMsg);
    } catch (logError) {
      console.error("Failed to log fatal error to test server:", logError.message);
    }
    return res.status(500).json({
      status: "error",
      message: "Internal server error during scheduling optimization."
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: "UP" });
});

app.listen(PORT, () => {
  console.log(`Vehicle Maintenance Scheduler Microservice is listening on port ${PORT}`);
});
