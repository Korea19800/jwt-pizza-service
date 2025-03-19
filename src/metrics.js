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
  const body = JSON.stringify(metrics); // Convert the unified metrics object to JSON string
  console.log(body);

  fetch(`${config.url}`, {
    method: "POST",
    body: body,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        response.text().then((text) => {
          console.error(
            `Failed to push metrics data to Grafana: ${text}\n${body}`
          );
        });
      } else {
        console.log(`Pushed metrics to Grafana.`);
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
    console.log("Done");
  });
  next();
}

function trackHttpMetrics(req) {
  httpStats.totalRequests++;
  httpStats.methodCounts[req.method] =
    (httpStats.methodCounts[req.method] || 0) + 1;
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
  // Successful login attempt (e.g., PUT /api/auth with valid credentials)
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
  buf.addMetric("cpu-usage", cpuUsage, "gauge", "1");
}
function addMemoyMetric(buf) {
  memoryPercentage = getMemoryUsagePercentage();
  buf.addMetric("memory-usage", memoryPercentage, "gauge", "1");
}

function systemMetrics(buf) {
  addCPUMetric(buf);
  addMemoyMetric(buf);
}

module.exports = {
  metricTracker,
};