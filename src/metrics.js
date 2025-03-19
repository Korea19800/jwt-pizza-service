const { MetricBuilder } = require("./MetricBuilder");
const config = require('./config');
const os = require('os');
// const config = require("../../grafana.config");

const httpStats = {
  totalRequests: 0,
  methodCounts: {
    GET: 0,
    POST: 0,
    PUT: 0,
    DELETE: 0,
  },
};

let activeUsers = 0;
let succesfulAuthAttempts = 0;
let unsuccessfulAuthAttempts = 0;
let cpuUsage = 0;
let memoryPercentage = 0;

// Debug mode to show more information in logs
const DEBUG = true;

setInterval(() => {
  try {
    const buf = new MetricBuilder();
    httpMetrics(buf);
    authMetrics(buf);
    authAttempMetrics(buf);
    systemMetrics(buf);
    // purchaseMetrics(buf);

    const metrics = buf.toJSON(); // Get unified metrics as a single JSON object
    sendMetricsToGrafana(metrics);
  } catch (error) {
    console.log("Error sending metrics", error);
  }
}, 5000);

function sendMetricsToGrafana(metrics) {
  // Add resource attribute for proper identification in Grafana Cloud
  if (!metrics.resourceMetrics || metrics.resourceMetrics.length === 0) {
    console.error("No metrics to send");
    return;
  }

  // Add resource attributes to each metric
  metrics.resourceMetrics.forEach(metric => {
    metric.resource = {
      attributes: [
        {
          key: "service.name",
          value: { stringValue: config.metrics?.source || "jwt-pizza-service" }
        }
      ]
    };
  });

  const body = JSON.stringify(metrics);
  
  if (DEBUG) {
    console.log("Metrics being sent:", JSON.stringify(metrics, null, 2));
    console.log("Target URL:", config.metrics?.url);
    console.log("Using API key starting with:", config.metrics?.apiKey?.substring(0, 10) + "...");
  } else {
    console.log("Sending metrics to Grafana...");
  }

  // Use the correct URL and API key from config
  if (!config.metrics?.url || !config.metrics?.apiKey) {
    console.error("Missing metrics URL or API key in config. Check your config.js file.");
    console.error("Config available:", JSON.stringify(config, null, 2));
    return;
  }

  fetch(config.metrics.url, {
    method: "POST",
    body: body,
    headers: {
      "Authorization": `Bearer ${config.metrics.apiKey}`,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        response.text().then((text) => {
          console.error(
            `Failed to push metrics data to Grafana: Status ${response.status}
            Error: ${text}
            Request body: ${body.substring(0, 200)}...`
          );
        });
      } else {
        console.log(`Successfully pushed metrics to Grafana. Status: ${response.status}`);
      }
    })
    .catch((error) => {
      console.error("Error pushing metrics:", error);
    });
}

function metricTracker(req, res, next) {
  // const start = Date.now();
  trackHttpMetrics(req);
  trackAuthMetrics(req, res);

  res.on("finish", () => {
    console.log("Request completed:", req.method, req.url, res.statusCode);
  });
  next();
}

function trackHttpMetrics(req) {
  httpStats.totalRequests++;
  if (req.method in httpStats.methodCounts) {
    httpStats.methodCounts[req.method]++;
  }
}

function httpMetrics(buf) {
  // Total number of requests
  buf.addMetric("http_requests_total", httpStats.totalRequests, "sum", "1");

  // Requests per method
  Object.entries(httpStats.methodCounts).forEach(([method, count]) => {
    buf.addMetric(`http_requests_${method.toLowerCase()}`, count, "sum", "1");
  });
}

function trackAuthMetrics(req, res) {
  if (req.method === "PUT" && req.url === "/api/auth") {
    activeUsers++;
    incrementAuthAttemptRates(res);
    console.log("User logged in. Active users:", activeUsers);
  } else if (req.method === "DELETE" && req.url === "/api/auth") {
    activeUsers = Math.max(0, activeUsers - 1);
    incrementAuthAttemptRates(res);
    console.log("User logged out. Active users:", activeUsers);
  }
}

function authMetrics(buf) {
  buf.addMetric("authenticated_users", activeUsers, "gauge", "1");
}

function incrementAuthAttemptRates(res) {
  res.on("finish", () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      succesfulAuthAttempts++;
      console.log("succesful login/logout attempt", res.statusCode);
    } else {
      unsuccessfulAuthAttempts++;
      console.log("unsuccesful login/logout attempt", res.statusCode);
    }
  });
}

function authAttempMetrics(buf) {
  buf.addMetric("successful_auth_attempts", succesfulAuthAttempts, "sum", "1");
  succesfulAuthAttempts = 0;
  buf.addMetric(
    "unsuccessful_auth_attempts",
    unsuccessfulAuthAttempts,
    "sum",
    "1"
  );
  unsuccessfulAuthAttempts = 0;
}

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Math.floor(cpuUsage.toFixed(2) * 100);
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return Math.floor(memoryUsage.toFixed(2));
}

function addCPUMetric(buf) {
  cpuUsage = getCpuUsagePercentage();
  buf.addMetric("cpu_usage", cpuUsage, "gauge", "1"); // Changed from hyphen to underscore for Prometheus compatibility
}

function addMemoyMetric(buf) {
  memoryPercentage = getMemoryUsagePercentage();
  buf.addMetric("memory_usage", memoryPercentage, "gauge", "1"); // Changed from hyphen to underscore for Prometheus compatibility
}

function systemMetrics(buf) {
  addCPUMetric(buf);
  addMemoyMetric(buf);
}

module.exports = {
  metricTracker,
};